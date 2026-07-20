import type { Merchant, MerchantStatus } from '@prisma/client';
import { prisma } from './db.js';

export interface MerchantPublic {
  id: string;
  apiKeyId: string;
  name: string;
  status: MerchantStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantVolume {
  asset: string;
  total: number;
}

export interface MerchantWithVolume extends MerchantPublic {
  volume: MerchantVolume[];
}

function toPublic(record: Merchant): MerchantPublic {
  return {
    id: record.id,
    apiKeyId: record.apiKeyId,
    name: record.name,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function createMerchant(input: {
  apiKeyId: string;
  name: string;
}): Promise<MerchantPublic> {
  const record = await prisma.merchant.create({
    data: { apiKeyId: input.apiKeyId, name: input.name },
  });
  return toPublic(record);
}

export async function getMerchant(id: string): Promise<MerchantPublic | null> {
  const record = await prisma.merchant.findUnique({ where: { id } });
  return record ? toPublic(record) : null;
}

export async function findActiveMerchant(
  apiKeyId: string,
  merchantId: string,
): Promise<MerchantPublic | null> {
  const record = await prisma.merchant.findFirst({
    where: { id: merchantId, apiKeyId, status: 'active' },
  });
  return record ? toPublic(record) : null;
}

export async function setMerchantStatus(
  id: string,
  status: MerchantStatus,
): Promise<MerchantPublic | null> {
  const existing = await prisma.merchant.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }
  const record = await prisma.merchant.update({ where: { id }, data: { status } });
  return toPublic(record);
}

export async function getMerchantVolume(merchantId: string): Promise<MerchantVolume[]> {
  const rows = await prisma.merchantSettlement.groupBy({
    by: ['asset'],
    where: { merchantId },
    _sum: { amount: true },
  });
  return rows.map((row) => ({ asset: row.asset, total: row._sum.amount ?? 0 }));
}

export async function listMerchantsForApiKey(apiKeyId: string): Promise<MerchantWithVolume[]> {
  const records = await prisma.merchant.findMany({
    where: { apiKeyId },
    orderBy: { createdAt: 'desc' },
  });
  return Promise.all(
    records.map(async (record) => ({
      ...toPublic(record),
      volume: await getMerchantVolume(record.id),
    })),
  );
}

export async function recordSettlement(input: {
  merchantId: string;
  escrowId: string;
  amount: number;
  asset: string;
}): Promise<void> {
  try {
    await prisma.merchantSettlement.create({ data: input });
  } catch (error) {
    // P2002 = unique constraint on escrowId: settlement already recorded, no-op.
    if ((error as { code?: string }).code === 'P2002') {
      return;
    }
    throw error;
  }
}
