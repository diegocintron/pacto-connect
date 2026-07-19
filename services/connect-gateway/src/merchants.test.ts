import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({
  prisma: {
    merchant: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    merchantSettlement: {
      create: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import type { Merchant } from '@prisma/client';
import { prisma } from './db.js';
import {
  createMerchant,
  findActiveMerchant,
  getMerchant,
  getMerchantVolume,
  listMerchantsForApiKey,
  recordSettlement,
  setMerchantStatus,
} from './merchants.js';

const baseMerchant: Merchant = {
  id: 'mrc_1',
  apiKeyId: 'key_1',
  name: 'Acme',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('merchants module', () => {
  beforeEach(() => {
    vi.mocked(prisma.merchant.create).mockReset();
    vi.mocked(prisma.merchant.findFirst).mockReset();
    vi.mocked(prisma.merchant.findMany).mockReset();
    vi.mocked(prisma.merchant.findUnique).mockReset();
    vi.mocked(prisma.merchant.update).mockReset();
    vi.mocked(prisma.merchantSettlement.create).mockReset();
    vi.mocked(prisma.merchantSettlement.groupBy).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('createMerchant returns a public shape', async () => {
    vi.mocked(prisma.merchant.create).mockResolvedValue(baseMerchant);
    const m = await createMerchant({ apiKeyId: 'key_1', name: 'Acme' });
    expect(m).toEqual({
      id: 'mrc_1',
      apiKeyId: 'key_1',
      name: 'Acme',
      status: 'active',
      createdAt: baseMerchant.createdAt,
      updatedAt: baseMerchant.updatedAt,
    });
  });

  it('findActiveMerchant returns null for a foreign or disabled merchant', async () => {
    vi.mocked(prisma.merchant.findFirst).mockResolvedValue(null);
    expect(await findActiveMerchant('key_1', 'mrc_x')).toBeNull();
    expect(prisma.merchant.findFirst).toHaveBeenCalledWith({
      where: { id: 'mrc_x', apiKeyId: 'key_1', status: 'active' },
    });
  });

  it('recordSettlement is idempotent (swallows unique-constraint conflict)', async () => {
    const err = Object.assign(new Error('unique'), { code: 'P2002' });
    vi.mocked(prisma.merchantSettlement.create).mockRejectedValueOnce(err);
    await expect(
      recordSettlement({ merchantId: 'mrc_1', escrowId: 'esc_1', amount: 100, asset: 'USDC' }),
    ).resolves.toBeUndefined();
  });

  it('getMerchantVolume aggregates by asset', async () => {
    vi.mocked(prisma.merchantSettlement.groupBy).mockResolvedValue([
      { asset: 'USDC', _sum: { amount: 300 } },
    ] as never);
    expect(await getMerchantVolume('mrc_1')).toEqual([{ asset: 'USDC', total: 300 }]);
  });

  it('listMerchantsForApiKey attaches volume per merchant', async () => {
    vi.mocked(prisma.merchant.findMany).mockResolvedValue([baseMerchant]);
    vi.mocked(prisma.merchantSettlement.groupBy).mockResolvedValue([
      { asset: 'USDC', _sum: { amount: 50 } },
    ] as never);
    const list = await listMerchantsForApiKey('key_1');
    expect(list[0]!.volume).toEqual([{ asset: 'USDC', total: 50 }]);
  });

  it('getMerchant returns the public shape when found', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue(baseMerchant);
    expect(await getMerchant('mrc_1')).toEqual({
      id: 'mrc_1',
      apiKeyId: 'key_1',
      name: 'Acme',
      status: 'active',
      createdAt: baseMerchant.createdAt,
      updatedAt: baseMerchant.updatedAt,
    });
  });

  it('getMerchant returns null when not found', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue(null);
    expect(await getMerchant('mrc_x')).toBeNull();
  });

  it('setMerchantStatus returns null without updating when the merchant does not exist', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue(null);
    expect(await setMerchantStatus('mrc_x', 'disabled')).toBeNull();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('setMerchantStatus returns the updated public shape when the merchant exists', async () => {
    const updated: Merchant = { ...baseMerchant, status: 'disabled' };
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue(baseMerchant);
    vi.mocked(prisma.merchant.update).mockResolvedValue(updated);
    expect(await setMerchantStatus('mrc_1', 'disabled')).toEqual({
      id: 'mrc_1',
      apiKeyId: 'key_1',
      name: 'Acme',
      status: 'disabled',
      createdAt: baseMerchant.createdAt,
      updatedAt: baseMerchant.updatedAt,
    });
    expect(prisma.merchant.update).toHaveBeenCalledWith({
      where: { id: 'mrc_1' },
      data: { status: 'disabled' },
    });
  });
});
