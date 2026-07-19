import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { toGatewayErrorBody } from '../errors.js';
import { dispatchEvent } from '../webhooks/delivery.js';
import { consumeNonce, releaseNonce } from '../webhooks/nonce.js';
import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  parseSignatureHeader,
  verifySignature,
  WEBHOOK_SIGNATURE_HEADER,
} from '../webhooks/signature.js';
import { isWebhookEventType, type WebhookEventType } from '../webhooks/types.js';

const inbound = new Hono();

function getInboundSecret(): string | undefined {
  return process.env.PACTO_WEBHOOK_SECRET;
}

function getToleranceSeconds(): number {
  const raw = process.env.WEBHOOK_REPLAY_TOLERANCE_SECONDS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
}

inbound.post('/', async (c) => {
  const rawBody = await c.req.text();
  const sigHeader = c.req.header(WEBHOOK_SIGNATURE_HEADER);

  if (!sigHeader) {
    console.warn('[inbound-webhook] rejected: missing signature header');
    return c.json(
      toGatewayErrorBody('webhook_error', 'signature_missing', 'signature required'),
      400,
    );
  }

  const secret = getInboundSecret();
  if (!secret) {
    console.error('[inbound-webhook] PACTO_WEBHOOK_SECRET is not configured');
    return c.json(
      toGatewayErrorBody(
        'webhook_error',
        'configuration_error',
        'inbound webhooks are not configured',
      ),
      500,
    );
  }
  const toleranceSeconds = getToleranceSeconds();

  if (!verifySignature(rawBody, sigHeader, secret, { toleranceSeconds })) {
    console.warn('[inbound-webhook] rejected: invalid signature or timestamp outside tolerance');
    return c.json(
      toGatewayErrorBody(
        'webhook_error',
        'signature_invalid',
        'signature invalid or replay outside tolerance',
      ),
      400,
    );
  }

  const parsed = parseSignatureHeader(sigHeader);
  if (!parsed?.nonce) {
    console.warn('[inbound-webhook] rejected: missing nonce');
    return c.json(toGatewayErrorBody('webhook_error', 'nonce_missing', 'nonce required'), 400);
  }

  const expiresAt = new Date((parsed.timestamp + toleranceSeconds) * 1000);
  const fresh = await consumeNonce({ nonce: parsed.nonce, expiresAt });
  if (!fresh) {
    console.warn(
      `[inbound-webhook] rejected: replay detected for nonce ${parsed.nonce.slice(0, 64)}`,
    );
    return c.json(
      toGatewayErrorBody('webhook_error', 'replay_detected', 'nonce already used'),
      409,
    );
  }

  let payload: { id?: unknown; apiKeyId?: unknown; type?: unknown; data?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json(
      toGatewayErrorBody('webhook_error', 'invalid_payload', 'body is not valid JSON'),
      400,
    );
  }

  if (payload === null || typeof payload !== 'object') {
    return c.json(
      toGatewayErrorBody('webhook_error', 'invalid_payload', 'body must be a JSON object'),
      400,
    );
  }

  if (typeof payload.apiKeyId !== 'string' || payload.apiKeyId.length === 0) {
    return c.json(
      toGatewayErrorBody('webhook_error', 'invalid_payload', 'apiKeyId is required'),
      400,
    );
  }
  if (typeof payload.id !== 'string' || payload.id.length === 0) {
    return c.json(
      toGatewayErrorBody('webhook_error', 'invalid_payload', 'event id is required'),
      400,
    );
  }
  if (typeof payload.type !== 'string' || !isWebhookEventType(payload.type)) {
    return c.json(
      toGatewayErrorBody('webhook_error', 'invalid_payload', 'unknown or missing event type'),
      400,
    );
  }

  let result: Awaited<ReturnType<typeof dispatchEvent>>;
  try {
    result = await dispatchEvent({
      apiKeyId: payload.apiKeyId,
      type: payload.type as WebhookEventType,
      data: (payload.data ?? {}) as Prisma.InputJsonValue,
      sourceEventId: payload.id,
    });
  } catch (error) {
    console.error('[inbound-webhook] dispatch failed', error);
    try {
      await releaseNonce(parsed.nonce);
    } catch (releaseError) {
      console.error('[inbound-webhook] failed to release nonce after dispatch failure', {
        nonce: parsed.nonce.slice(0, 64),
        error: releaseError,
      });
    }
    return c.json(
      toGatewayErrorBody('webhook_error', 'dispatch_failed', 'failed to process event'),
      500,
    );
  }

  return c.json({ received: true, eventId: result.eventId, deduped: result.deduped ?? false });
});

export { inbound as inboundWebhookRoutes };
