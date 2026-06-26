import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey, KeyMode } from '@prisma/client';
import { prisma } from './db.js';

const KEY_RANDOM_BYTES = 24;

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
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin);
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

  const pair = generateKeyPair(existing.mode);

  const record = await prisma.apiKey.update({
    where: { id },
    data: {
      secretKeyHash: hashSecretKey(pair.secretKey),
      secretLast4: pair.secretKey.slice(-4),
    },
  });

  return {
    ...toPublic(record),
    secretKey: pair.secretKey,
  };
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
  return prisma.apiKey.findFirst({
    where: {
      publishableKey,
      status: 'active',
    },
  });
}
