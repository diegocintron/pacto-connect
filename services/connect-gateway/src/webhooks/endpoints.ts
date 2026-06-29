import { randomBytes } from 'node:crypto';
import type { WebhookEndpoint, WebhookStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { postSignedWebhook } from './transport.js';
import { isWebhookEventType, WEBHOOK_VERIFICATION_EVENT } from './types.js';

const SECRET_RANDOM_BYTES = 24;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(SECRET_RANDOM_BYTES).toString('base64url')}`;
}

export interface RegisterEndpointInput {
  apiKeyId: string;
  url: string;
  enabledEvents: string[];
  description?: string;
}

export interface WebhookEndpointPublic {
  id: string;
  apiKeyId: string;
  url: string;
  enabledEvents: string[];
  status: WebhookStatus;
  verified: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEndpointCreated extends WebhookEndpointPublic {
  secret: string;
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

function toPublic(record: WebhookEndpoint): WebhookEndpointPublic {
  return {
    id: record.id,
    apiKeyId: record.apiKeyId,
    url: record.url,
    enabledEvents: record.enabledEvents,
    status: record.status,
    verified: record.verified,
    description: record.description,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function validateEndpointInput(input: RegisterEndpointInput): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    throw new WebhookValidationError('url must be a valid http(s) URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new WebhookValidationError('url must be a valid http(s) URL');
  }

  if (!Array.isArray(input.enabledEvents) || input.enabledEvents.length === 0) {
    throw new WebhookValidationError('enabledEvents must be a non-empty array');
  }

  for (const evt of input.enabledEvents) {
    if (!isWebhookEventType(evt)) {
      throw new WebhookValidationError(`unknown event type: ${evt}`);
    }
  }
}

export async function registerEndpoint(
  input: RegisterEndpointInput,
): Promise<WebhookEndpointCreated> {
  validateEndpointInput(input);

  const secret = generateWebhookSecret();

  const record = await prisma.webhookEndpoint.create({
    data: {
      apiKeyId: input.apiKeyId,
      url: input.url,
      secret,
      enabledEvents: input.enabledEvents,
      description: input.description,
    },
  });

  return {
    ...toPublic(record),
    secret,
  };
}

export async function listEndpoints(apiKeyId?: string): Promise<WebhookEndpointPublic[]> {
  const records = await prisma.webhookEndpoint.findMany({
    where: apiKeyId ? { apiKeyId } : undefined,
    orderBy: { createdAt: 'desc' },
  });

  return records.map(toPublic);
}

export async function getEndpoint(id: string): Promise<WebhookEndpointPublic | null> {
  const record = await prisma.webhookEndpoint.findUnique({ where: { id } });
  return record ? toPublic(record) : null;
}

export async function setEndpointStatus(
  id: string,
  status: WebhookStatus,
): Promise<WebhookEndpointPublic | null> {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  const record = await prisma.webhookEndpoint.update({
    where: { id },
    data: { status },
  });

  return toPublic(record);
}

export async function deleteEndpoint(id: string): Promise<boolean> {
  try {
    await prisma.webhookEndpoint.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export interface VerifyEndpointResult {
  verified: boolean;
  status?: number;
  error?: string;
}

export async function verifyEndpoint(
  id: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<VerifyEndpointResult | null> {
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id } });
  if (!endpoint) {
    return null;
  }

  const challenge = randomBytes(16).toString('hex');
  const payload = {
    id: `evt_verify_${challenge.slice(0, 8)}`,
    type: WEBHOOK_VERIFICATION_EVENT,
    created: Math.floor(Date.now() / 1000),
    data: { challenge },
  };
  const body = JSON.stringify(payload);

  const result = await postSignedWebhook(endpoint.url, body, endpoint.secret, {
    fetchImpl: options?.fetchImpl,
  });

  if (!result.ok) {
    return {
      verified: false,
      status: result.status,
      error:
        result.error ??
        (result.status !== undefined ? `unexpected status ${result.status}` : undefined),
    };
  }

  let parsed: { challenge?: string };
  try {
    parsed = JSON.parse(result.bodyText ?? '');
  } catch {
    return {
      verified: false,
      status: result.status,
      error: 'endpoint did not echo challenge',
    };
  }

  if (parsed.challenge !== challenge) {
    return {
      verified: false,
      status: result.status,
      error: 'endpoint did not echo challenge',
    };
  }

  await prisma.webhookEndpoint.update({
    where: { id },
    data: { verified: true },
  });

  return { verified: true, status: result.status };
}
