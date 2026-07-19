import type { ApiKey } from '@prisma/client';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { SessionError, sessionErrorStatus, toGatewayErrorBody } from '../errors.js';
import { idempotency } from '../middleware/idempotency.js';
import { validateClientSecret } from '../sessions.js';
import {
  getSimulator,
  SimulatorError,
  type SimulatorEscrow,
  type SimulatorEvent,
} from '../testmode/simulator.js';

type EscrowRouteVariables = {
  apiKey: ApiKey;
};

const escrows = new Hono<{ Variables: EscrowRouteVariables }>();

function extractClientSecret(c: Context): string | null {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

export async function authenticateEscrowRequest(c: Context) {
  const clientSecret = extractClientSecret(c);
  if (!clientSecret) {
    return {
      error: c.json(
        toGatewayErrorBody(
          'validation_error',
          'invalid_request',
          'Authorization Bearer client secret is required',
        ),
        401,
      ),
    } as const;
  }

  try {
    const session = await validateClientSecret(clientSecret);
    const apiKey = c.get('apiKey');

    if (session.apiKeyId !== apiKey.id) {
      return {
        error: c.json(
          toGatewayErrorBody('session_error', 'session_invalid', 'Session does not match API key'),
          401,
        ),
      } as const;
    }

    return { session, apiKey } as const;
  } catch (error) {
    if (error instanceof SessionError) {
      return {
        error: c.json(
          toGatewayErrorBody('session_error', error.code, error.message),
          sessionErrorStatus(error.code),
        ),
      } as const;
    }

    throw error;
  }
}

export function serializeEscrow(escrow: SimulatorEscrow) {
  return {
    id: escrow.id,
    quoteId: escrow.quoteId,
    status: escrow.status,
    amount: escrow.amount,
    asset: escrow.asset,
    createdAt: escrow.createdAt,
    updatedAt: escrow.updatedAt,
  };
}

export function simulatorErrorResponse(c: Context, error: SimulatorError) {
  if (error.code === 'escrow_not_found') {
    return c.json(toGatewayErrorBody('escrow_error', error.code, error.message), 404);
  }

  return c.json(toGatewayErrorBody('escrow_error', error.code, error.message), 409);
}

function liveNotImplemented(c: Context) {
  return c.json(
    toGatewayErrorBody('gateway_error', 'not_implemented', 'live escrow proxy not available'),
    501,
  );
}

function serializeSseData(event: SimulatorEvent): string {
  return JSON.stringify({
    escrowId: event.escrowId,
    occurredAt: event.occurredAt,
    milestone: event.milestone,
    ...event.data,
  });
}

escrows.get('/events', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const escrowId = c.req.query('escrowId') || undefined;
  const cursor = c.req.header('Last-Event-ID') || c.req.query('cursor') || undefined;
  const simulator = getSimulator();

  return streamSSE(c, async (stream) => {
    const replay = simulator.getEventsSince(session.id, escrowId, cursor, apiKey.id);

    for (const event of replay) {
      await stream.writeSSE({
        id: event.cursor,
        event: event.type,
        data: serializeSseData(event),
      });
    }

    await new Promise<void>((resolve) => {
      const unsubscribe = simulator.subscribe(session.id, escrowId, async (event) => {
        try {
          await stream.writeSSE({
            id: event.cursor,
            event: event.type,
            data: serializeSseData(event),
          });
        } catch {
          unsubscribe();
          resolve();
        }
      });

      c.req.raw.signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          resolve();
        },
        { once: true },
      );
    });
  });
});

escrows.post('/', idempotency(), async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const body = await c.req.json<{ quoteId?: string; amount?: string; asset?: string }>();

  if (!body.quoteId || typeof body.quoteId !== 'string') {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'quoteId is required'),
      400,
    );
  }

  const escrow = getSimulator().createEscrow({
    apiKeyId: apiKey.id,
    sessionId: session.id,
    quoteId: body.quoteId,
    amount: typeof body.amount === 'string' ? body.amount : '100',
    asset: typeof body.asset === 'string' ? body.asset : 'USDC',
  });

  return c.json({ escrow: serializeEscrow(escrow) });
});

escrows.get('/:id', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  try {
    const escrow = getSimulator().getEscrow(session.id, c.req.param('id'), apiKey.id);
    return c.json({ escrow: serializeEscrow(escrow) });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }

    throw error;
  }
});

escrows.get('/:id/status', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  try {
    const escrow = getSimulator().getEscrow(session.id, c.req.param('id'), apiKey.id);
    return c.json({
      status: {
        id: escrow.id,
        status: escrow.status,
        updatedAt: escrow.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }

    throw error;
  }
});

escrows.post('/:id/deposit', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  try {
    const escrow = getSimulator().deposit(session.id, c.req.param('id'), apiKey.id);
    return c.json({ escrow: serializeEscrow(escrow) });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }

    throw error;
  }
});

escrows.post('/:id/fiat-report', async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const body = await c.req.json<{ method?: string; reference?: string; receipt?: string }>();

  if (body.method !== 'SINPE' && body.method !== 'SPEI') {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'method must be SINPE or SPEI'),
      400,
    );
  }

  if (!body.reference || typeof body.reference !== 'string') {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'reference is required'),
      400,
    );
  }

  try {
    const escrow = getSimulator().reportFiat(
      session.id,
      c.req.param('id'),
      {
        method: body.method,
        reference: body.reference,
        receipt: typeof body.receipt === 'string' ? body.receipt : undefined,
      },
      apiKey.id,
    );
    return c.json({ escrow: serializeEscrow(escrow) });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }

    throw error;
  }
});

export { escrows as escrowRoutes };
