import type { KeyMode } from '@prisma/client';
import { Hono } from 'hono';
import { prisma } from '../db.js';
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '../keys.js';
import { createMerchant, listMerchantsForApiKey, setMerchantStatus } from '../merchants.js';
import { adminAuth } from '../middleware/admin.js';
import { webhookRoutes } from './webhooks.js';

const admin = new Hono();

admin.use('*', adminAuth);
admin.route('/webhooks', webhookRoutes);

admin.get('/keys', async (c) => {
  const keys = await listApiKeys();
  return c.json({ keys });
});

admin.post('/keys', async (c) => {
  const body = await c.req.json<{
    mode?: KeyMode;
    allowedOrigins?: string[];
    label?: string;
    quoteSpreadBps?: number;
  }>();

  if (!body.mode || (body.mode !== 'live' && body.mode !== 'test')) {
    return c.json({ error: 'mode must be "live" or "test"' }, 400);
  }

  if (!Array.isArray(body.allowedOrigins) || body.allowedOrigins.length === 0) {
    return c.json({ error: 'allowedOrigins must be a non-empty array' }, 400);
  }

  for (const origin of body.allowedOrigins) {
    if (typeof origin !== 'string' || !origin.startsWith('http')) {
      return c.json({ error: 'each allowedOrigin must be a valid http(s) origin' }, 400);
    }
  }

  if (body.quoteSpreadBps !== undefined) {
    if (
      !Number.isInteger(body.quoteSpreadBps) ||
      body.quoteSpreadBps < 0 ||
      body.quoteSpreadBps > 10000
    ) {
      return c.json({ error: 'quoteSpreadBps must be an integer between 0 and 10000' }, 400);
    }
  }

  const key = await createApiKey({
    mode: body.mode,
    allowedOrigins: body.allowedOrigins,
    label: body.label,
    quoteSpreadBps: body.quoteSpreadBps,
  });

  return c.json({ key }, 201);
});

admin.post('/keys/:id/rotate', async (c) => {
  const id = c.req.param('id');
  const key = await rotateApiKey(id);

  if (!key) {
    return c.json({ error: 'key not found or revoked' }, 404);
  }

  return c.json({ key });
});

admin.post('/keys/:id/revoke', async (c) => {
  const id = c.req.param('id');
  const key = await revokeApiKey(id);

  if (!key) {
    return c.json({ error: 'key not found' }, 404);
  }

  return c.json({ key });
});

admin.post('/keys/:keyId/merchants', async (c) => {
  const keyId = c.req.param('keyId');
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) {
    return c.json({ error: 'key not found' }, 404);
  }
  const body = await c.req.json<{ name?: string }>();
  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400);
  }
  const merchant = await createMerchant({ apiKeyId: keyId, name: body.name });
  return c.json({ merchant }, 201);
});

admin.get('/keys/:keyId/merchants', async (c) => {
  const keyId = c.req.param('keyId');
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) {
    return c.json({ error: 'key not found' }, 404);
  }
  const merchants = await listMerchantsForApiKey(keyId);
  return c.json({ merchants });
});

admin.post('/merchants/:id/disable', async (c) => {
  const merchant = await setMerchantStatus(c.req.param('id'), 'disabled');
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }
  return c.json({ merchant });
});

export { admin as adminRoutes };
