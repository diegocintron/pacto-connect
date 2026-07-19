import type { ApiKey, Subscription } from '@prisma/client';
import { Hono } from 'hono';
import { SubscriptionError, subscriptionErrorStatus, toGatewayErrorBody } from '../errors.js';
import { idempotency } from '../middleware/idempotency.js';
import {
  cancelSubscription,
  createSubscription,
  getSubscription,
  listSubscriptions,
} from '../subscriptions/subscriptions.js';
import { emitSubscriptionCanceled, emitSubscriptionCreated } from '../webhooks/events.js';
import { authenticateEscrowRequest } from './escrows.js';

type SubscriptionRouteVariables = { apiKey: ApiKey };

const subscriptions = new Hono<{ Variables: SubscriptionRouteVariables }>();

export function serializeSubscription(sub: Subscription) {
  return {
    id: sub.id,
    status: sub.status,
    from: sub.from,
    to: sub.to,
    amount: sub.amount,
    asset: sub.asset,
    interval: sub.interval,
    payerRef: sub.payerRef,
    nextChargeAt: sub.nextChargeAt.toISOString(),
    canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
  };
}

function liveNotImplemented(c: Parameters<typeof authenticateEscrowRequest>[0]) {
  return c.json(
    toGatewayErrorBody('gateway_error', 'not_implemented', 'live subscriptions not available'),
    501,
  );
}

subscriptions.post('/', idempotency(), async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  let body: {
    from?: string;
    to?: string;
    amount?: number;
    interval?: string;
    asset?: string;
    payerRef?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'body must be valid JSON'),
      400,
    );
  }

  try {
    const sub = await createSubscription({
      apiKeyId: apiKey.id,
      sessionId: session.id,
      from: typeof body.from === 'string' ? body.from : '',
      to: typeof body.to === 'string' ? body.to : '',
      amount: typeof body.amount === 'number' ? body.amount : Number.NaN,
      interval: typeof body.interval === 'string' ? body.interval : '',
      asset: typeof body.asset === 'string' ? body.asset : undefined,
      payerRef: typeof body.payerRef === 'string' ? body.payerRef : undefined,
    });

    await emitSubscriptionCreated(apiKey.id, {
      subscriptionId: sub.id,
      from: sub.from,
      to: sub.to,
      amount: sub.amount,
      interval: sub.interval,
    });

    return c.json({ subscription: serializeSubscription(sub) });
  } catch (error) {
    if (error instanceof SubscriptionError) {
      return c.json(
        toGatewayErrorBody('subscription_error', error.code, error.message),
        subscriptionErrorStatus(error.code),
      );
    }
    throw error;
  }
});

subscriptions.get('/', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const list = await listSubscriptions(apiKey.id, session.id);
  return c.json({ subscriptions: list.map(serializeSubscription) });
});

subscriptions.get('/:id', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const sub = await getSubscription(c.req.param('id'), apiKey.id, session.id);
  if (!sub) {
    return c.json(
      toGatewayErrorBody('subscription_error', 'subscription_not_found', 'Subscription not found'),
      404,
    );
  }

  return c.json({ subscription: serializeSubscription(sub) });
});

subscriptions.post('/:id/cancel', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const result = await cancelSubscription(c.req.param('id'), apiKey.id, session.id);
  if (!result) {
    return c.json(
      toGatewayErrorBody('subscription_error', 'subscription_not_found', 'Subscription not found'),
      404,
    );
  }

  if (result.transitioned) {
    await emitSubscriptionCanceled(apiKey.id, { subscriptionId: result.subscription.id });
  }

  return c.json({ subscription: serializeSubscription(result.subscription) });
});

export { subscriptions as subscriptionRoutes };
