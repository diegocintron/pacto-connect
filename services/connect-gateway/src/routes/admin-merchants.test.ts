import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../merchants.js', () => ({
  createMerchant: vi.fn(),
  listMerchantsForApiKey: vi.fn(),
  setMerchantStatus: vi.fn(),
}));
vi.mock('../db.js', () => ({ prisma: { apiKey: { findUnique: vi.fn() } } }));
vi.mock('../middleware/admin.js', () => ({
  adminAuth: (_c: unknown, next: () => Promise<void>) => next(),
}));

import { prisma } from '../db.js';
import { createMerchant, listMerchantsForApiKey, setMerchantStatus } from '../merchants.js';
import { adminRoutes } from './admin.js';

describe('admin merchant routes', () => {
  beforeEach(() => {
    vi.mocked(createMerchant).mockReset();
    vi.mocked(listMerchantsForApiKey).mockReset();
    vi.mocked(setMerchantStatus).mockReset();
    vi.mocked(prisma.apiKey.findUnique).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('POST creates a sub-merchant under an existing key', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({ id: 'key_1' } as never);
    vi.mocked(createMerchant).mockResolvedValue({ id: 'mrc_1', name: 'Acme' } as never);
    const res = await adminRoutes.request('/keys/key_1/merchants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(createMerchant).mock.calls[0]![0]).toEqual({
      apiKeyId: 'key_1',
      name: 'Acme',
    });
  });

  it('POST 404s for an unknown key', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(null);
    const res = await adminRoutes.request('/keys/key_x/merchants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET lists merchants with volume', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({ id: 'key_1' } as never);
    vi.mocked(listMerchantsForApiKey).mockResolvedValue([
      { id: 'mrc_1', name: 'Acme', volume: [{ asset: 'USDC', total: 300 }] } as never,
    ]);
    const res = await adminRoutes.request('/keys/key_1/merchants');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.merchants[0].volume).toEqual([{ asset: 'USDC', total: 300 }]);
  });

  it('POST /merchants/:id/disable disables a merchant', async () => {
    vi.mocked(setMerchantStatus).mockResolvedValue({ id: 'mrc_1', status: 'disabled' } as never);
    const res = await adminRoutes.request('/merchants/mrc_1/disable', { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.merchant).toEqual({ id: 'mrc_1', status: 'disabled' });
    expect(vi.mocked(setMerchantStatus).mock.calls[0]).toEqual(['mrc_1', 'disabled']);
  });

  it('POST /merchants/:id/disable 404s for an unknown merchant', async () => {
    vi.mocked(setMerchantStatus).mockResolvedValue(null);
    const res = await adminRoutes.request('/merchants/mrc_x/disable', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
