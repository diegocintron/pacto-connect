import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: { webhookNonce: { create: vi.fn(), delete: vi.fn() } },
}));

import { prisma } from '../db.js';
import { consumeNonce, releaseNonce } from './nonce.js';

describe('consumeNonce', () => {
  beforeEach(() => {
    vi.mocked(prisma.webhookNonce.create).mockReset();
  });

  it('returns true when the nonce is fresh', async () => {
    vi.mocked(prisma.webhookNonce.create).mockResolvedValue({} as never);
    const fresh = await consumeNonce({ nonce: 'n1', expiresAt: new Date() });
    expect(fresh).toBe(true);
  });

  it('returns false when the nonce already exists (P2002)', async () => {
    vi.mocked(prisma.webhookNonce.create).mockRejectedValue({ code: 'P2002' });
    const fresh = await consumeNonce({ nonce: 'n1', expiresAt: new Date() });
    expect(fresh).toBe(false);
  });

  it('rethrows unexpected errors', async () => {
    vi.mocked(prisma.webhookNonce.create).mockRejectedValue(new Error('db down'));
    await expect(consumeNonce({ nonce: 'n1', expiresAt: new Date() })).rejects.toThrow('db down');
  });
});

describe('releaseNonce', () => {
  beforeEach(() => {
    vi.mocked(prisma.webhookNonce.delete).mockReset();
  });

  it('resolves when the nonce is deleted', async () => {
    vi.mocked(prisma.webhookNonce.delete).mockResolvedValue({} as never);
    await expect(releaseNonce('n1')).resolves.toBeUndefined();
  });

  it('does not throw when the nonce is already gone (P2025)', async () => {
    vi.mocked(prisma.webhookNonce.delete).mockRejectedValue({ code: 'P2025' });
    await expect(releaseNonce('n1')).resolves.toBeUndefined();
  });

  it('rethrows unexpected errors', async () => {
    vi.mocked(prisma.webhookNonce.delete).mockRejectedValue(new Error('db down'));
    await expect(releaseNonce('n1')).rejects.toThrow('db down');
  });
});
