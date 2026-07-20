import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({
  prisma: {
    apiKey: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock())),
  },
}));

import type { ApiKey } from '@prisma/client';
import { prisma } from './db.js';
import { cutoverApiKey, findActiveApiKeyByPublishableKey, rotateApiKey } from './keys.js';
import { isOriginAllowed, matchOrigin, normalizeOrigin } from './keys.js';

function prismaMock() {
  return prisma;
}

const baseKey: ApiKey = {
  id: 'key_old',
  publishableKey: 'pk_test_old',
  secretKeyHash: 'hash_old',
  secretLast4: 'old4',
  mode: 'test',
  allowedOrigins: ['https://shop.example'],
  status: 'active',
  label: 'shop',
  quoteSpreadBps: 10,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  rotatedFromId: null,
  graceExpiresAt: null,
};

describe('rotateApiKey', () => {
  beforeEach(() => {
    vi.mocked(prisma.apiKey.findUnique).mockReset();
    vi.mocked(prisma.apiKey.create).mockReset();
    vi.mocked(prisma.apiKey.update).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('creates a new pk_/sk_ pair linked to the predecessor and sets grace on the old key', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockImplementation((async (args: any) =>
      args.where.rotatedFromId ? null : baseKey) as any);
    vi.mocked(prisma.apiKey.create).mockImplementation((async ({ data }: any) => ({
      ...baseKey,
      id: 'key_new',
      publishableKey: data.publishableKey,
      secretKeyHash: data.secretKeyHash,
      secretLast4: data.secretLast4,
      rotatedFromId: data.rotatedFromId,
    })) as any);
    vi.mocked(prisma.apiKey.update).mockResolvedValue({ ...baseKey });

    const result = await rotateApiKey('key_old');

    expect(result).not.toBeNull();
    expect(result?.publishableKey.startsWith('pk_test_')).toBe(true);
    expect(result?.secretKey.startsWith('sk_test_')).toBe(true);
    expect(result?.rotatedFromId).toBe('key_old');
    // old key gets a grace window, stays active
    expect(vi.mocked(prisma.apiKey.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'key_old' },
        data: expect.objectContaining({ graceExpiresAt: expect.any(Date) }),
      }),
    );
  });

  it('returns null for a missing or revoked key', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(null);
    expect(await rotateApiKey('nope')).toBeNull();

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({ ...baseKey, status: 'revoked' });
    expect(await rotateApiKey('key_old')).toBeNull();
  });

  it('returns null when the key was already rotated (successor already exists)', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockImplementation((async (args: any) =>
      args.where.rotatedFromId
        ? { ...baseKey, id: 'key_new', rotatedFromId: 'key_old' }
        : baseKey) as any);

    const result = await rotateApiKey('key_old');

    expect(result).toBeNull();
    expect(vi.mocked(prisma.apiKey.create)).not.toHaveBeenCalled();
  });
});

describe('cutoverApiKey', () => {
  beforeEach(() => {
    vi.mocked(prisma.apiKey.findUnique).mockReset();
    vi.mocked(prisma.apiKey.update).mockReset();
  });

  it('revokes the predecessor of a rotated key', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
      ...baseKey,
      id: 'key_new',
      rotatedFromId: 'key_old',
    });
    vi.mocked(prisma.apiKey.update).mockResolvedValue({ ...baseKey, status: 'revoked' });

    const result = await cutoverApiKey('key_new');

    expect(result?.status).toBe('revoked');
    expect(vi.mocked(prisma.apiKey.update)).toHaveBeenCalledWith({
      where: { id: 'key_old' },
      data: { status: 'revoked' },
    });
  });

  it('returns null when there is no predecessor to cut over', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({ ...baseKey, rotatedFromId: null });
    expect(await cutoverApiKey('key_new')).toBeNull();
  });

  it('revokes the old key directly when called with its own id during its grace window', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
      ...baseKey,
      id: 'key_old',
      rotatedFromId: null,
      graceExpiresAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    vi.mocked(prisma.apiKey.update).mockResolvedValue({ ...baseKey, status: 'revoked' });

    const result = await cutoverApiKey('key_old');

    expect(vi.mocked(prisma.apiKey.update)).toHaveBeenCalledWith({
      where: { id: 'key_old' },
      data: { status: 'revoked' },
    });
    expect(result?.status).toBe('revoked');
  });
});

describe('findActiveApiKeyByPublishableKey lazy grace expiry', () => {
  beforeEach(() => {
    vi.mocked(prisma.apiKey.findFirst).mockReset();
    vi.mocked(prisma.apiKey.update).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns the key while still within the grace window', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      ...baseKey,
      graceExpiresAt: new Date('2026-06-11T00:00:00.000Z'),
    });
    const result = await findActiveApiKeyByPublishableKey('pk_test_old');
    expect(result).not.toBeNull();
    expect(vi.mocked(prisma.apiKey.update)).not.toHaveBeenCalled();
  });

  it('revokes and returns null once the grace window has passed', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      ...baseKey,
      graceExpiresAt: new Date('2026-06-09T00:00:00.000Z'),
    });
    vi.mocked(prisma.apiKey.update).mockResolvedValue({ ...baseKey, status: 'revoked' });

    const result = await findActiveApiKeyByPublishableKey('pk_test_old');

    expect(result).toBeNull();
    expect(vi.mocked(prisma.apiKey.update)).toHaveBeenCalledWith({
      where: { id: 'key_old' },
      data: { status: 'revoked' },
    });
  });
});

describe('normalizeOrigin', () => {
  it('canonicalizes a valid origin and lowercases the host', () => {
    expect(normalizeOrigin('https://App.Example.com')).toBe('https://app.example.com');
  });
  it('preserves an explicit port', () => {
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });
  it('rejects non-http(s) schemes', () => {
    expect(normalizeOrigin('ftp://example.com')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
  });
  it('rejects values carrying a path, query, fragment, or credentials', () => {
    expect(normalizeOrigin('https://example.com/path')).toBeNull();
    expect(normalizeOrigin('https://example.com/?x=1')).toBeNull();
    expect(normalizeOrigin('https://user:pass@example.com')).toBeNull();
  });
  it('rejects garbage', () => {
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });
});

describe('matchOrigin', () => {
  it('matches an exact origin', () => {
    expect(matchOrigin('https://shop.example', 'https://shop.example')).toBe(true);
  });
  it('matches a single subdomain label under a wildcard', () => {
    expect(matchOrigin('https://app.example.com', 'https://*.example.com')).toBe(true);
  });
  it('does NOT match the apex under a wildcard', () => {
    expect(matchOrigin('https://example.com', 'https://*.example.com')).toBe(false);
  });
  it('does NOT match multi-level subdomains under a wildcard', () => {
    expect(matchOrigin('https://a.b.example.com', 'https://*.example.com')).toBe(false);
  });
  it('rejects protocol and port mismatches', () => {
    expect(matchOrigin('http://app.example.com', 'https://*.example.com')).toBe(false);
    expect(matchOrigin('https://app.example.com:8443', 'https://*.example.com')).toBe(false);
  });
  it('never matches a bare wildcard', () => {
    expect(matchOrigin('https://anything.com', '*')).toBe(false);
    expect(matchOrigin('https://anything.com', 'https://*')).toBe(false);
  });
  it('rejects a bare wildcard regardless of scheme case', () => {
    expect(matchOrigin('https://anything.com', 'HTTPS://*')).toBe(false);
    expect(matchOrigin('https://*', 'HTTPS://*')).toBe(false);
    expect(matchOrigin('https://anything.com', 'HTTP://*')).toBe(false);
  });
  it('matches a single-label wildcard with an explicit port', () => {
    expect(matchOrigin('https://app.example.com:8443', 'https://*.example.com:8443')).toBe(true);
    expect(matchOrigin('https://app.example.com', 'https://*.example.com:8443')).toBe(false);
  });
  it('rejects an FQDN trailing-dot host', () => {
    expect(matchOrigin('https://app.example.com.', 'https://*.example.com')).toBe(false);
    expect(matchOrigin('https://app.example.com.', 'https://app.example.com')).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  it('returns true when any pattern matches', () => {
    expect(isOriginAllowed('https://app.example.com', ['https://x.io', 'https://*.example.com'])).toBe(true);
  });
  it('returns false for a malformed origin', () => {
    expect(isOriginAllowed('not a url', ['https://*.example.com'])).toBe(false);
  });
  it('returns false when nothing matches', () => {
    expect(isOriginAllowed('https://evil.example', ['https://shop.example'])).toBe(false);
  });
});
