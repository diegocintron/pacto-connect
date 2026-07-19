import { prisma } from '../db.js';

export interface ConsumeNonceInput {
  nonce: string;
  expiresAt: Date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2025'
  );
}

/**
 * Records the nonce. Returns true if it was fresh, false if it was already
 * seen (a replay). Relies on the unique constraint to win concurrent races.
 */
export async function consumeNonce(input: ConsumeNonceInput): Promise<boolean> {
  try {
    await prisma.webhookNonce.create({
      data: { nonce: input.nonce, expiresAt: input.expiresAt },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Deletes a previously consumed nonce so a legitimately retried delivery can
 * be reprocessed. Best-effort: a missing row (P2025) is ignored.
 */
export async function releaseNonce(nonce: string): Promise<void> {
  try {
    await prisma.webhookNonce.delete({ where: { nonce } });
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
}
