import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { toGatewayErrorBody } from '../errors.js';
import { getSimulator, SimulatorError } from '../testmode/simulator.js';
import { authenticateEscrowRequest, serializeEscrow, simulatorErrorResponse } from './escrows.js';

type TestControlVariables = {
  apiKey: ApiKey;
};

const testControls = new Hono<{ Variables: TestControlVariables }>();

function requireTestMode(c: { get: (key: 'apiKey') => ApiKey }) {
  const apiKey = c.get('apiKey');
  if (apiKey.mode !== 'test') {
    return {
      ok: false as const,
      body: toGatewayErrorBody(
        'forbidden',
        'live_key_not_allowed',
        'test controls require a test-mode key',
      ),
      status: 403 as const,
    };
  }

  return { ok: true as const, apiKey };
}

testControls.post('/escrows/:id/dispute', async (c) => {
  const modeCheck = requireTestMode(c);
  if (!modeCheck.ok) {
    return c.json(modeCheck.body, modeCheck.status);
  }

  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  const body = (await c.req.json<{ reason?: string }>().catch(() => ({}))) as {
    reason?: string;
  };

  try {
    const escrow = getSimulator().forceDispute(
      session.id,
      c.req.param('id'),
      typeof body.reason === 'string' ? body.reason : undefined,
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

testControls.post('/escrows/:id/timeout', async (c) => {
  const modeCheck = requireTestMode(c);
  if (!modeCheck.ok) {
    return c.json(modeCheck.body, modeCheck.status);
  }

  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  try {
    const escrow = getSimulator().forceTimeout(session.id, c.req.param('id'), apiKey.id);
    return c.json({ escrow: serializeEscrow(escrow) });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }

    throw error;
  }
});

testControls.post('/escrows/:id/release', async (c) => {
  const modeCheck = requireTestMode(c);
  if (!modeCheck.ok) {
    return c.json(modeCheck.body, modeCheck.status);
  }

  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;

  try {
    const escrow = getSimulator().forceRelease(session.id, c.req.param('id'), apiKey.id);
    return c.json({ escrow: serializeEscrow(escrow) });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }

    throw error;
  }
});

export { testControls as testControlRoutes };
