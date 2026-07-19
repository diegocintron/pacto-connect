import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({
  prisma: {
    idempotencyRecord: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from './db.js';
import { beginIdempotency, completeIdempotency, computeRequestHash } from './idempotency.js';

const base = { apiKeyId: 'key_1', key: 'idem_1', requestHash: 'hash_1' };

describe('computeRequestHash', () => {
  it('is stable and differs by body', () => {
    const a = computeRequestHash('POST', '/v1/session', '{"a":1}');
    const b = computeRequestHash('POST', '/v1/session', '{"a":1}');
    const c = computeRequestHash('POST', '/v1/session', '{"a":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('beginIdempotency', () => {
  beforeEach(() => {
    vi.mocked(prisma.idempotencyRecord.create).mockReset();
    vi.mocked(prisma.idempotencyRecord.findUnique).mockReset();
  });

  it('proceeds when no record exists', async () => {
    vi.mocked(prisma.idempotencyRecord.create).mockResolvedValue({} as never);
    expect(await beginIdempotency(base)).toEqual({ kind: 'proceed' });
  });

  it('replays a completed record with a matching hash', async () => {
    vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue({ code: 'P2002' });
    vi.mocked(prisma.idempotencyRecord.findUnique).mockResolvedValue({
      requestHash: 'hash_1',
      status: 'completed',
      statusCode: 200,
      responseBody: '{"ok":true}',
    } as never);
    expect(await beginIdempotency(base)).toEqual({
      kind: 'replay',
      statusCode: 200,
      responseBody: '{"ok":true}',
    });
  });

  it('reports a mismatch when the same key has a different body hash', async () => {
    vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue({ code: 'P2002' });
    vi.mocked(prisma.idempotencyRecord.findUnique).mockResolvedValue({
      requestHash: 'DIFFERENT',
      status: 'completed',
      statusCode: 200,
      responseBody: '{"ok":true}',
    } as never);
    expect(await beginIdempotency(base)).toEqual({ kind: 'mismatch' });
  });

  it('reports in_progress when the existing record is still pending', async () => {
    vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue({ code: 'P2002' });
    vi.mocked(prisma.idempotencyRecord.findUnique).mockResolvedValue({
      requestHash: 'hash_1',
      status: 'pending',
      statusCode: null,
      responseBody: null,
    } as never);
    expect(await beginIdempotency(base)).toEqual({ kind: 'in_progress' });
  });
});

describe('completeIdempotency', () => {
  it('updates the record to completed with the captured response', async () => {
    vi.mocked(prisma.idempotencyRecord.update).mockResolvedValue({} as never);
    await completeIdempotency({
      apiKeyId: 'key_1',
      key: 'idem_1',
      statusCode: 201,
      responseBody: '{"x":1}',
    });
    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { apiKeyId_key: { apiKeyId: 'key_1', key: 'idem_1' } },
      data: { status: 'completed', statusCode: 201, responseBody: '{"x":1}' },
    });
  });
});
