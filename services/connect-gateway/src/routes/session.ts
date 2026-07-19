import type { ApiKey, CheckoutMode, Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { SessionError, sessionErrorStatus, toGatewayErrorBody } from '../errors.js';
import { idempotency } from '../middleware/idempotency.js';
import { createCheckoutSession, refreshCheckoutSession } from '../sessions.js';

type SessionRouteVariables = {
  apiKey: ApiKey;
};

const session = new Hono<{ Variables: SessionRouteVariables }>();

function isCheckoutMode(value: string): value is CheckoutMode {
  return value === 'buy' || value === 'sell';
}

session.post('/', idempotency(), async (c) => {
  const apiKey = c.get('apiKey');
  const body = await c.req.json<{
    listingId?: string;
    quote?: Record<string, unknown>;
    mode?: string;
  }>();

  const hasListingId = typeof body.listingId === 'string' && body.listingId.length > 0;
  const hasQuote =
    body.quote !== undefined && body.quote !== null && typeof body.quote === 'object';

  if (!hasListingId && !hasQuote) {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'listingId or quote is required'),
      400,
    );
  }

  if (hasListingId && hasQuote) {
    return c.json(
      toGatewayErrorBody(
        'validation_error',
        'invalid_request',
        'provide listingId or quote, not both',
      ),
      400,
    );
  }

  if (!body.mode || !isCheckoutMode(body.mode)) {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'mode must be "buy" or "sell"'),
      400,
    );
  }

  try {
    const result = await createCheckoutSession({
      apiKeyId: apiKey.id,
      mode: body.mode,
      listingId: hasListingId ? body.listingId : undefined,
      quote: hasQuote ? (body.quote as Prisma.InputJsonValue) : undefined,
    });

    return c.json({
      sessionId: result.sessionId,
      clientSecret: result.clientSecret,
      expiresAt: result.expiresAt.toISOString(),
      mode: result.mode,
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return c.json(
        toGatewayErrorBody('session_error', error.code, error.message),
        sessionErrorStatus(error.code),
      );
    }

    throw error;
  }
});

session.post('/refresh', async (c) => {
  const body = await c.req.json<{ clientSecret?: string }>();

  if (!body.clientSecret || typeof body.clientSecret !== 'string') {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'clientSecret is required'),
      400,
    );
  }

  try {
    const result = await refreshCheckoutSession(body.clientSecret);

    return c.json({
      sessionId: result.sessionId,
      clientSecret: result.clientSecret,
      expiresAt: result.expiresAt.toISOString(),
      mode: result.mode,
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return c.json(
        toGatewayErrorBody('session_error', error.code, error.message),
        sessionErrorStatus(error.code),
      );
    }

    throw error;
  }
});

export { session as sessionRoutes };
