import { createHash } from 'node:crypto';
import { prisma } from './db.js';

export function computeRequestHash(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${body}`).digest('hex');
}

export type BeginResult =
  | { kind: 'proceed' }
  | { kind: 'replay'; statusCode: number; responseBody: string }
  | { kind: 'mismatch' }
  | { kind: 'in_progress' };

export interface BeginInput {
  apiKeyId: string;
  key: string;
  requestHash: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function beginIdempotency(input: BeginInput): Promise<BeginResult> {
  try {
    await prisma.idempotencyRecord.create({
      data: {
        apiKeyId: input.apiKeyId,
        key: input.key,
        requestHash: input.requestHash,
        status: 'pending',
      },
    });
    return { kind: 'proceed' };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { apiKeyId_key: { apiKeyId: input.apiKeyId, key: input.key } },
  });

  if (!existing) {
    return { kind: 'proceed' };
  }

  if (existing.requestHash !== input.requestHash) {
    return { kind: 'mismatch' };
  }

  if (
    existing.status === 'completed' &&
    existing.statusCode !== null &&
    existing.responseBody !== null
  ) {
    return {
      kind: 'replay',
      statusCode: existing.statusCode,
      responseBody: existing.responseBody,
    };
  }

  return { kind: 'in_progress' };
}

export interface CompleteInput {
  apiKeyId: string;
  key: string;
  statusCode: number;
  responseBody: string;
}

export async function completeIdempotency(input: CompleteInput): Promise<void> {
  await prisma.idempotencyRecord.update({
    where: { apiKeyId_key: { apiKeyId: input.apiKeyId, key: input.key } },
    data: {
      status: 'completed',
      statusCode: input.statusCode,
      responseBody: input.responseBody,
    },
  });
}
