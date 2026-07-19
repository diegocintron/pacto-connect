import type { Prisma, WebhookDelivery, WebhookDeliveryStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { postSignedWebhook } from './transport.js';
import type { WebhookEventType } from './types.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_BASE_MS = 5000;
const DEFAULT_BACKOFF_CAP_MS = 3_600_000;

function parsePositiveEnv(name: string, fallback: number): number {
  const configured = process.env[name];
  if (!configured) {
    return fallback;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function getMaxAttempts(): number {
  return parsePositiveEnv('WEBHOOK_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS);
}

export function getBackoffBaseMs(): number {
  return parsePositiveEnv('WEBHOOK_BACKOFF_BASE_MS', DEFAULT_BACKOFF_BASE_MS);
}

export function getBackoffCapMs(): number {
  return parsePositiveEnv('WEBHOOK_BACKOFF_CAP_MS', DEFAULT_BACKOFF_CAP_MS);
}

export function computeBackoffMs(attempt: number): number {
  const base = getBackoffBaseMs();
  const cap = getBackoffCapMs();
  return Math.min(base * 2 ** (attempt - 1), cap);
}

export interface DispatchInput {
  apiKeyId: string;
  type: WebhookEventType;
  data: Prisma.InputJsonValue;
  sourceEventId?: string;
}

export interface DispatchResult {
  eventId: string;
  deliveries: number;
  deduped?: boolean;
}

export async function dispatchEvent(input: DispatchInput): Promise<DispatchResult> {
  if (input.sourceEventId) {
    const existing = await prisma.webhookEvent.findUnique({
      where: { sourceEventId: input.sourceEventId },
    });
    if (existing) {
      return { eventId: existing.id, deliveries: 0, deduped: true };
    }
  }

  const event = await prisma.webhookEvent.create({
    data: {
      apiKeyId: input.apiKeyId,
      type: input.type,
      data: input.data,
      sourceEventId: input.sourceEventId,
    },
  });

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      apiKeyId: input.apiKeyId,
      status: 'enabled',
      verified: true,
      enabledEvents: { has: input.type },
    },
  });

  const maxAttempts = getMaxAttempts();
  await Promise.all(
    endpoints.map((endpoint) =>
      prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventId: event.id,
          eventType: input.type,
          maxAttempts,
        },
      }),
    ),
  );

  return { eventId: event.id, deliveries: endpoints.length };
}

export interface AttemptResult {
  deliveryId: string;
  status: WebhookDeliveryStatus;
  statusCode?: number;
  error?: string;
}

export async function attemptDelivery(
  deliveryId: string,
  options?: { now?: Date; fetchImpl?: typeof fetch },
): Promise<AttemptResult> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true, event: true },
  });

  if (!delivery) {
    throw new Error('delivery not found');
  }

  if (delivery.status === 'succeeded' || delivery.status === 'dead') {
    return { deliveryId, status: delivery.status };
  }

  const now = options?.now ?? new Date();
  const body = JSON.stringify({
    id: delivery.event.id,
    type: delivery.eventType,
    created: Math.floor(delivery.event.createdAt.getTime() / 1000),
    data: delivery.event.data,
  });

  const result = await postSignedWebhook(delivery.endpoint.url, body, delivery.endpoint.secret, {
    fetchImpl: options?.fetchImpl,
  });

  const attempts = delivery.attempts + 1;

  if (result.ok) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'succeeded',
        attempts,
        deliveredAt: now,
        lastStatusCode: result.status ?? null,
        lastError: null,
      },
    });

    return { deliveryId, status: 'succeeded', statusCode: result.status };
  }

  const exhausted = attempts >= delivery.maxAttempts;
  const status = exhausted ? 'dead' : 'failed';
  const nextAttemptAt = exhausted
    ? delivery.nextAttemptAt
    : new Date(now.getTime() + computeBackoffMs(attempts));
  const errorMessage =
    result.error ??
    (result.status !== undefined ? `unexpected status ${result.status}` : 'delivery failed');

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status,
      attempts,
      lastStatusCode: result.status ?? null,
      lastError: errorMessage,
      nextAttemptAt,
    },
  });

  return { deliveryId, status, statusCode: result.status, error: errorMessage };
}

export interface RunResult {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
}

export async function runDueDeliveries(options?: {
  now?: Date;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<RunResult> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 20;

  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  const tally: RunResult = { processed: 0, succeeded: 0, failed: 0, dead: 0 };

  for (const delivery of due) {
    const result = await attemptDelivery(delivery.id, { now, fetchImpl: options?.fetchImpl });
    tally.processed += 1;
    if (result.status === 'succeeded') {
      tally.succeeded += 1;
    } else if (result.status === 'failed') {
      tally.failed += 1;
    } else if (result.status === 'dead') {
      tally.dead += 1;
    }
  }

  return tally;
}

export async function listDeliveries(filter?: {
  status?: WebhookDeliveryStatus;
  endpointId?: string;
  eventId?: string;
  limit?: number;
}): Promise<WebhookDelivery[]> {
  const where: Prisma.WebhookDeliveryWhereInput = {};
  if (filter?.status !== undefined) {
    where.status = filter.status;
  }
  if (filter?.endpointId !== undefined) {
    where.endpointId = filter.endpointId;
  }
  if (filter?.eventId !== undefined) {
    where.eventId = filter.eventId;
  }

  return prisma.webhookDelivery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filter?.limit ?? 100,
  });
}

export async function listDeadLetterDeliveries(limit?: number): Promise<WebhookDelivery[]> {
  return listDeliveries({ status: 'dead', limit });
}

export async function requeueDelivery(id: string): Promise<WebhookDelivery | null> {
  const existing = await prisma.webhookDelivery.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  return prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: 'pending',
      nextAttemptAt: new Date(),
      lastError: null,
      maxAttempts: existing.attempts + getMaxAttempts(),
    },
  });
}
