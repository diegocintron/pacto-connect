import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CheckoutMode, CheckoutSession, Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { SessionError } from './errors.js';

const CLIENT_SECRET_PREFIX = 'cs_';
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;

export interface CreateSessionInput {
  apiKeyId: string;
  mode: CheckoutMode;
  listingId?: string;
  quote?: Prisma.InputJsonValue;
}

export interface SessionResult {
  sessionId: string;
  clientSecret: string;
  expiresAt: Date;
  mode: CheckoutMode;
}

function getSessionTtlMs(): number {
  const configured = process.env.SESSION_TTL_MS;
  if (!configured) {
    return DEFAULT_SESSION_TTL_MS;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_TTL_MS;
  }

  return parsed;
}

function getSigningSecret(): string {
  const secret = process.env.GATEWAY_SIGNING_SECRET;
  if (!secret) {
    throw new Error('GATEWAY_SIGNING_SECRET is not configured');
  }

  return secret;
}

function computeSignature(sessionId: string, apiKeyId: string, expiresAt: Date): string {
  const payload = `${sessionId}|${apiKeyId}|${expiresAt.toISOString()}`;
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

export function buildClientSecret(sessionId: string, apiKeyId: string, expiresAt: Date): string {
  const signature = computeSignature(sessionId, apiKeyId, expiresAt);
  return `${CLIENT_SECRET_PREFIX}${sessionId}.${signature}`;
}

export function hashClientSecret(clientSecret: string): string {
  return createHash('sha256').update(clientSecret).digest('hex');
}

export function parseClientSecret(
  clientSecret: string,
): { sessionId: string; signature: string } | null {
  if (!clientSecret.startsWith(CLIENT_SECRET_PREFIX)) {
    return null;
  }

  const rest = clientSecret.slice(CLIENT_SECRET_PREFIX.length);
  const separatorIndex = rest.indexOf('.');
  if (separatorIndex === -1) {
    return null;
  }

  const sessionId = rest.slice(0, separatorIndex);
  const signature = rest.slice(separatorIndex + 1);
  if (!sessionId || !signature) {
    return null;
  }

  return { sessionId, signature };
}

function signaturesMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function createCheckoutSession(input: CreateSessionInput): Promise<SessionResult> {
  const expiresAt = new Date(Date.now() + getSessionTtlMs());

  const session = await prisma.checkoutSession.create({
    data: {
      apiKeyId: input.apiKeyId,
      mode: input.mode,
      listingId: input.listingId,
      quote: input.quote ?? undefined,
      expiresAt,
      clientSecretHash: '',
    },
  });

  const clientSecret = buildClientSecret(session.id, input.apiKeyId, expiresAt);
  const clientSecretHash = hashClientSecret(clientSecret);

  const updated = await prisma.checkoutSession.update({
    where: { id: session.id },
    data: { clientSecretHash },
  });

  return {
    sessionId: updated.id,
    clientSecret,
    expiresAt: updated.expiresAt,
    mode: updated.mode,
  };
}

export async function refreshCheckoutSession(clientSecret: string): Promise<SessionResult> {
  const session = await validateClientSecret(clientSecret);
  const newExpiresAt = new Date(Date.now() + getSessionTtlMs());
  const newClientSecret = buildClientSecret(session.id, session.apiKeyId, newExpiresAt);
  const newHash = hashClientSecret(newClientSecret);

  const updated = await prisma.checkoutSession.update({
    where: { id: session.id },
    data: {
      expiresAt: newExpiresAt,
      clientSecretHash: newHash,
      refreshCount: { increment: 1 },
      status: 'active',
    },
  });

  return {
    sessionId: updated.id,
    clientSecret: newClientSecret,
    expiresAt: updated.expiresAt,
    mode: updated.mode,
  };
}

export async function validateClientSecret(clientSecret: string): Promise<CheckoutSession> {
  const parsed = parseClientSecret(clientSecret);
  if (!parsed) {
    throw new SessionError('session_invalid', 'Invalid client secret format');
  }

  const session = await prisma.checkoutSession.findUnique({
    where: { id: parsed.sessionId },
  });

  if (!session) {
    throw new SessionError('session_invalid', 'Session not found');
  }

  if (session.status === 'revoked' || session.status === 'consumed') {
    throw new SessionError('session_invalid', 'Session is no longer valid');
  }

  const expectedSignature = computeSignature(session.id, session.apiKeyId, session.expiresAt);
  if (!signaturesMatch(parsed.signature, expectedSignature)) {
    throw new SessionError('session_invalid', 'Client secret signature mismatch');
  }

  const hash = hashClientSecret(clientSecret);
  if (hash !== session.clientSecretHash) {
    throw new SessionError('session_invalid', 'Client secret hash mismatch');
  }

  if (session.expiresAt < new Date() || session.status === 'expired') {
    if (session.status !== 'expired') {
      await prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: 'expired' },
      });
    }

    throw new SessionError('session_expired', 'Session has expired');
  }

  return session;
}
