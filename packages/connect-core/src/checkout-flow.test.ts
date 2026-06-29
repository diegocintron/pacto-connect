import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutFlowController } from './checkout-flow.js';

const gatewayUrl = 'https://gateway.example';
const listingId = 'lst_1';

const listing = {
  id: listingId,
  asset: 'USDC',
  amount: '100',
  price: '5000',
  side: 'buy' as const,
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const quote = {
  id: 'quo_1',
  listingId,
  asset: 'USDC',
  amount: '100',
  price: '5000',
  side: 'buy' as const,
  expiresAt: '2024-01-02T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const escrow = {
  id: 'esc_1',
  quoteId: quote.id,
  status: 'pending' as const,
  amount: '100',
  asset: 'USDC',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function createFetchMock(testCalls: { url: string; method: string }[] = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/v1/session') && method === 'POST') {
      return jsonResponse({
        sessionId: 'sess_1',
        clientSecret: 'cs_sess_1.sig',
        expiresAt: '2099-01-01T00:00:00.000Z',
        mode: 'buy',
      });
    }

    if (url.includes(`/v1/listings/${listingId}`)) {
      return jsonResponse({ listing });
    }

    if (url.endsWith('/v1/quotes') && method === 'POST') {
      return jsonResponse({ quote });
    }

    if (url.endsWith('/v1/escrows') && method === 'POST') {
      return jsonResponse({ escrow });
    }

    if (url.includes('/v1/test/escrows/')) {
      testCalls.push({ url, method });
      return jsonResponse({ escrow: { ...escrow, status: 'released' } });
    }

    if (url.includes('/v1/escrows/events')) {
      return jsonResponse({});
    }

    return jsonResponse({ error: 'not found' }, 404);
  });
}

async function startTestController(publishableKey: string): Promise<CheckoutFlowController> {
  const controller = new CheckoutFlowController({
    publishableKey,
    gatewayUrl,
    listingId,
  });

  await controller.start();
  return controller;
}

describe('CheckoutFlowController test controls', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'idem-key-123'),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forceTestRelease calls api.test.forceRelease with the current escrow id', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_test_123');
    expect(controller.getState().testMode).toBe(true);

    await controller.forceTestRelease();

    expect(testCalls).toContainEqual({
      url: expect.stringContaining('/v1/test/escrows/esc_1/release'),
      method: 'POST',
    });

    controller.destroy();
  });

  it('forceTestDispute calls api.test.forceDispute with the current escrow id', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_test_123');

    await controller.forceTestDispute('buyer_claim');

    expect(testCalls).toContainEqual({
      url: expect.stringContaining('/v1/test/escrows/esc_1/dispute'),
      method: 'POST',
    });

    controller.destroy();
  });

  it('forceTestTimeout calls api.test.forceTimeout with the current escrow id', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_test_123');

    await controller.forceTestTimeout();

    expect(testCalls).toContainEqual({
      url: expect.stringContaining('/v1/test/escrows/esc_1/timeout'),
      method: 'POST',
    });

    controller.destroy();
  });

  it('forceTest* methods no-op when not in test mode', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_live_123');
    expect(controller.getState().testMode).toBe(false);

    await controller.forceTestRelease();
    await controller.forceTestDispute();
    await controller.forceTestTimeout();

    expect(testCalls).toHaveLength(0);

    controller.destroy();
  });
});
