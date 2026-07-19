import type { WebhookDeliveryStatus } from '@prisma/client';
import { Hono } from 'hono';
import { findActiveMerchant } from '../merchants.js';
import { listDeadLetterDeliveries, listDeliveries, requeueDelivery } from '../webhooks/delivery.js';
import {
  deleteEndpoint,
  getEndpoint,
  listEndpoints,
  registerEndpoint,
  setEndpointStatus,
  verifyEndpoint,
  WebhookValidationError,
} from '../webhooks/endpoints.js';

const VALID_DELIVERY_STATUSES = ['pending', 'succeeded', 'failed', 'dead'] as const;

function parseDeliveryStatus(value: string | undefined): WebhookDeliveryStatus | undefined {
  if (!value) {
    return undefined;
  }
  if ((VALID_DELIVERY_STATUSES as readonly string[]).includes(value)) {
    return value as WebhookDeliveryStatus;
  }
  return undefined;
}

function parsePositiveQuery(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

const webhooks = new Hono();

webhooks.get('/', async (c) => {
  const apiKeyId = c.req.query('apiKeyId');
  const merchantId = c.req.query('merchantId');
  return c.json({ endpoints: await listEndpoints(apiKeyId, merchantId) });
});

webhooks.post('/', async (c) => {
  const body = await c.req.json<{
    apiKeyId?: string;
    merchantId?: string;
    url?: string;
    enabledEvents?: string[];
    description?: string;
  }>();

  if (!body.apiKeyId || typeof body.apiKeyId !== 'string') {
    return c.json({ error: 'apiKeyId is required' }, 400);
  }

  if (!body.url || typeof body.url !== 'string') {
    return c.json({ error: 'url is required' }, 400);
  }

  if (body.merchantId !== undefined) {
    if (typeof body.merchantId !== 'string' || body.merchantId.length === 0) {
      return c.json({ error: 'merchantId must be a non-empty string' }, 400);
    }
    const merchant = await findActiveMerchant(body.apiKeyId, body.merchantId);
    if (!merchant) {
      return c.json({ error: 'merchantId is unknown, disabled, or not owned by this key' }, 400);
    }
  }

  try {
    const endpoint = await registerEndpoint({
      apiKeyId: body.apiKeyId,
      merchantId: body.merchantId,
      url: body.url,
      enabledEvents: body.enabledEvents ?? [],
      description: body.description,
    });
    return c.json({ endpoint }, 201);
  } catch (e) {
    if (e instanceof WebhookValidationError) {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }
});

webhooks.get('/deliveries', async (c) => {
  const status = parseDeliveryStatus(c.req.query('status'));
  const endpointId = c.req.query('endpointId');
  const eventId = c.req.query('eventId');
  const limit = parsePositiveQuery(c.req.query('limit'));

  return c.json({
    deliveries: await listDeliveries({ status, endpointId, eventId, limit }),
  });
});

webhooks.get('/dlq', async (c) => {
  const limit = parsePositiveQuery(c.req.query('limit'));
  return c.json({ deliveries: await listDeadLetterDeliveries(limit) });
});

webhooks.post('/deliveries/:id/retry', async (c) => {
  const delivery = await requeueDelivery(c.req.param('id'));
  if (!delivery) {
    return c.json({ error: 'delivery not found' }, 404);
  }
  return c.json({ delivery });
});

webhooks.get('/:id', async (c) => {
  const endpoint = await getEndpoint(c.req.param('id'));
  if (!endpoint) {
    return c.json({ error: 'endpoint not found' }, 404);
  }
  return c.json({ endpoint });
});

webhooks.post('/:id/verify', async (c) => {
  const result = await verifyEndpoint(c.req.param('id'));
  if (result === null) {
    return c.json({ error: 'endpoint not found' }, 404);
  }
  return c.json({ result });
});

webhooks.post('/:id/enable', async (c) => {
  const endpoint = await setEndpointStatus(c.req.param('id'), 'enabled');
  if (!endpoint) {
    return c.json({ error: 'endpoint not found' }, 404);
  }
  return c.json({ endpoint });
});

webhooks.post('/:id/disable', async (c) => {
  const endpoint = await setEndpointStatus(c.req.param('id'), 'disabled');
  if (!endpoint) {
    return c.json({ error: 'endpoint not found' }, 404);
  }
  return c.json({ endpoint });
});

webhooks.delete('/:id', async (c) => {
  const ok = await deleteEndpoint(c.req.param('id'));
  if (!ok) {
    return c.json({ error: 'endpoint not found' }, 404);
  }
  return c.body(null, 204);
});

export { webhooks as webhookRoutes };
