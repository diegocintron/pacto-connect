import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey, KeyMode } from '@prisma/client';
import { prisma } from './db.js';

const KEY_RANDOM_BYTES = 24;

const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

function gracePeriodMs(): number {
  const raw = process.env.KEY_ROTATION_GRACE_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_GRACE_MS;
}

export interface CreateKeyInput {
  mode: KeyMode;
  allowedOrigins: string[];
  label?: string;
  quoteSpreadBps?: number;
}

export interface KeyPair {
  publishableKey: string;
  secretKey: string;
}

export interface ApiKeyPublic {
  id: string;
  publishableKey: string;
  secretLast4: string;
  mode: KeyMode;
  allowedOrigins: string[];
  status: ApiKey['status'];
  label: string | null;
  quoteSpreadBps: number;
  rotatedFromId: string | null;
  graceExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyCreated extends ApiKeyPublic {
  secretKey: string;
}

function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(KEY_RANDOM_BYTES).toString('base64url')}`;
}

function prefixesForMode(mode: KeyMode): { publishable: string; secret: string } {
  return mode === 'live'
    ? { publishable: 'pk_live', secret: 'sk_live' }
    : { publishable: 'pk_test', secret: 'sk_test' };
}

export function hashSecretKey(secretKey: string): string {
  return createHash('sha256').update(secretKey).digest('hex');
}

export function generateKeyPair(mode: KeyMode): KeyPair {
  const prefixes = prefixesForMode(mode);
  return {
    publishableKey: generateToken(prefixes.publishable),
    secretKey: generateToken(prefixes.secret),
  };
}

function toPublic(record: ApiKey): ApiKeyPublic {
  return {
    id: record.id,
    publishableKey: record.publishableKey,
    secretLast4: record.secretLast4,
    mode: record.mode,
    allowedOrigins: record.allowedOrigins,
    status: record.status,
    label: record.label,
    quoteSpreadBps: record.quoteSpreadBps,
    rotatedFromId: record.rotatedFromId,
    graceExpiresAt: record.graceExpiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function normalizeOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.username !== '' || url.password !== '') {
    return null;
  }
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    return null;
  }
  return url.origin.toLowerCase();
}

const WILDCARD_PATTERN = /^(https?):\/\/\*\.([a-z0-9.-]+)(?::(\d+))?$/i;

export function matchOrigin(requestOrigin: string, pattern: string): boolean {
  const normalizedRequest = normalizeOrigin(requestOrigin);
  if (!normalizedRequest) {
    return false;
  }

  const wildcard = WILDCARD_PATTERN.exec(pattern);
  if (wildcard) {
    const [, proto, base, port] = wildcard as unknown as [
      string,
      string,
      string,
      string | undefined,
    ];
    const requestUrl = new URL(normalizedRequest);
    if (requestUrl.protocol !== `${proto.toLowerCase()}:`) {
      return false;
    }
    if ((port ?? '') !== requestUrl.port) {
      return false;
    }
    const host = requestUrl.hostname;
    const suffix = `.${base.toLowerCase()}`;
    if (!host.endsWith(suffix)) {
      return false;
    }
    const label = host.slice(0, host.length - suffix.length);
    return label.length > 0 && !label.includes('.');
  }

  // Reject bare wildcards explicitly (case-insensitive).
  const normalizedPatternText = pattern.trim().toLowerCase();
  if (normalizedPatternText === '*' || /^https?:\/\/\*\/?$/.test(normalizedPatternText)) {
    return false;
  }

  const normalizedPattern = normalizeOrigin(pattern);
  if (!normalizedPattern) {
    return false;
  }
  return normalizedRequest === normalizedPattern;
}

export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((pattern) => matchOrigin(origin, pattern));
}

export async function createApiKey(input: CreateKeyInput): Promise<ApiKeyCreated> {
  const pair = generateKeyPair(input.mode);

  const record = await prisma.apiKey.create({
    data: {
      publishableKey: pair.publishableKey,
      secretKeyHash: hashSecretKey(pair.secretKey),
      secretLast4: pair.secretKey.slice(-4),
      mode: input.mode,
      allowedOrigins: input.allowedOrigins,
      label: input.label,
      quoteSpreadBps: input.quoteSpreadBps ?? 0,
    },
  });

  return {
    ...toPublic(record),
    secretKey: pair.secretKey,
  };
}

export async function rotateApiKey(id: string): Promise<ApiKeyCreated | null> {
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing || existing.status === 'revoked') {
    return null;
  }

  const alreadyRotated = await prisma.apiKey.findUnique({
    where: { rotatedFromId: existing.id },
  });
  if (alreadyRotated) {
    return null;
  }

  const pair = generateKeyPair(existing.mode);
  const graceExpiresAt = new Date(Date.now() + gracePeriodMs());

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.apiKey.create({
      data: {
        publishableKey: pair.publishableKey,
        secretKeyHash: hashSecretKey(pair.secretKey),
        secretLast4: pair.secretKey.slice(-4),
        mode: existing.mode,
        allowedOrigins: existing.allowedOrigins,
        label: existing.label,
        quoteSpreadBps: existing.quoteSpreadBps,
        rotatedFromId: existing.id,
      },
    });
    await tx.apiKey.update({
      where: { id: existing.id },
      data: { graceExpiresAt },
    });
    return record;
  });

  return {
    ...toPublic(created),
    secretKey: pair.secretKey,
  };
}

export async function cutoverApiKey(id: string): Promise<ApiKeyPublic | null> {
  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) {
    return null;
  }

  // Revoke the predecessor when given the new key's id; when given an old key
  // that is itself in a grace window (rotatedFromId null but graceExpiresAt set),
  // revoke that old key directly. Otherwise there is nothing to cut over.
  const targetId = key.rotatedFromId ?? (key.graceExpiresAt ? key.id : null);
  if (!targetId) {
    return null;
  }

  const record = await prisma.apiKey.update({
    where: { id: targetId },
    data: { status: 'revoked' },
  });
  return toPublic(record);
}

export async function revokeApiKey(id: string): Promise<ApiKeyPublic | null> {
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  const record = await prisma.apiKey.update({
    where: { id },
    data: { status: 'revoked' },
  });

  return toPublic(record);
}

export async function listApiKeys(): Promise<ApiKeyPublic[]> {
  const records = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  return records.map(toPublic);
}

export async function findActiveApiKeyByPublishableKey(
  publishableKey: string,
): Promise<ApiKey | null> {
  const key = await prisma.apiKey.findFirst({
    where: {
      publishableKey,
      status: 'active',
    },
  });
  if (!key) {
    return null;
  }

  if (key.graceExpiresAt && key.graceExpiresAt.getTime() <= Date.now()) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { status: 'revoked' } });
    return null;
  }

  return key;
}
