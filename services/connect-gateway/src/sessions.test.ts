import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckoutSession = {
  id: 'session_1',
  apiKeyId: 'key_1',
  mode: 'buy' as const,
  listingId: 'listing_1',
  quote: null,
  clientSecretHash: '',
  status: 'active' as const,
  expiresAt: new Date('2024-06-01T12:15:00.000Z'),
  refreshCount: 0,
  createdAt: new Date('2024-06-01T12:00:00.000Z'),
  updatedAt: new Date('2024-06-01T12:00:00.000Z'),
};

vi.mock('./db.js', () => ({
  prisma: {
    checkoutSession: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import type { CheckoutSession } from '@prisma/client';
import { prisma } from './db.js';
import {
  buildClientSecret,
  hashClientSecret,
  refreshCheckoutSession,
  validateClientSecret,
} from './sessions.js';

describe('sessions service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    vi.mocked(prisma.checkoutSession.create).mockReset();
    vi.mocked(prisma.checkoutSession.update).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds client secrets that cannot be used across sessions', async () => {
    const expiresAt = new Date('2024-06-01T12:15:00.000Z');
    const secretOne = buildClientSecret('session_1', 'key_1', expiresAt);
    const secretTwo = buildClientSecret('session_2', 'key_1', expiresAt);

    vi.mocked(prisma.checkoutSession.findUnique)
      .mockResolvedValueOnce({
        ...mockCheckoutSession,
        expiresAt,
        clientSecretHash: hashClientSecret(secretOne),
      } as CheckoutSession)
      .mockResolvedValueOnce(null);

    await expect(validateClientSecret(secretOne)).resolves.toMatchObject({ id: 'session_1' });
    await expect(validateClientSecret(secretTwo)).rejects.toEqual(
      expect.objectContaining({ code: 'session_invalid' }),
    );
  });

  it('rejects expired sessions with a typed error', async () => {
    const expiredAt = new Date('2024-06-01T11:00:00.000Z');
    const clientSecret = buildClientSecret('session_1', 'key_1', expiredAt);
    const expiredSession = {
      id: 'session_1',
      apiKeyId: 'key_1',
      mode: 'buy' as const,
      listingId: 'listing_1',
      quote: null,
      clientSecretHash: hashClientSecret(clientSecret),
      status: 'active' as const,
      expiresAt: expiredAt,
      refreshCount: 0,
      createdAt: new Date('2024-06-01T12:00:00.000Z'),
      updatedAt: new Date('2024-06-01T12:00:00.000Z'),
    };

    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(
      expiredSession as CheckoutSession,
    );
    vi.mocked(prisma.checkoutSession.update).mockResolvedValue({
      ...expiredSession,
      status: 'expired',
    } as CheckoutSession);

    await expect(validateClientSecret(clientSecret)).rejects.toEqual(
      expect.objectContaining({ code: 'session_expired' }),
    );
  });

  it('refreshes a session and rotates the client secret', async () => {
    const expiresAt = new Date('2024-06-01T13:00:00.000Z');
    const clientSecret = buildClientSecret('session_1', 'key_1', expiresAt);
    const refreshedExpiresAt = new Date('2024-06-01T12:35:00.000Z');

    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue({
      ...mockCheckoutSession,
      expiresAt,
      clientSecretHash: hashClientSecret(clientSecret),
    } as CheckoutSession);
    vi.mocked(prisma.checkoutSession.update).mockResolvedValue({
      ...mockCheckoutSession,
      expiresAt: refreshedExpiresAt,
      refreshCount: 1,
      clientSecretHash: hashClientSecret(
        buildClientSecret('session_1', 'key_1', refreshedExpiresAt),
      ),
    } as CheckoutSession);

    vi.setSystemTime(new Date('2024-06-01T12:20:00.000Z'));

    const result = await refreshCheckoutSession(clientSecret);

    expect(result.sessionId).toBe('session_1');
    expect(result.clientSecret).toBe(buildClientSecret('session_1', 'key_1', refreshedExpiresAt));
    expect(result.expiresAt.toISOString()).toBe(refreshedExpiresAt.toISOString());
  });

  it('rejects secrets from another api key even with the same session id', async () => {
    const expiresAt = new Date('2024-06-01T12:15:00.000Z');
    const foreignSecret = buildClientSecret('session_1', 'key_2', expiresAt);

    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue({
      ...mockCheckoutSession,
      expiresAt,
      clientSecretHash: hashClientSecret(buildClientSecret('session_1', 'key_1', expiresAt)),
    } as CheckoutSession);

    await expect(validateClientSecret(foreignSecret)).rejects.toEqual(
      expect.objectContaining({ code: 'session_invalid' }),
    );
  });
});
