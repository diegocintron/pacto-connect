import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PactoCheckout } from './PactoCheckout';

const gatewayUrl = 'https://gateway.example';
const publishableKey = 'pk_test_123';
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

function encodeSse(block: string): Uint8Array {
  return new TextEncoder().encode(block);
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function sseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encodeSse(event));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
    headers: new Headers(),
  } as Response;
}

function createDeferredSseResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  return {
    response: () =>
      ({
        ok: true,
        status: 200,
        body: stream,
        headers: new Headers(),
      }) as Response,
    push: (block: string) => controller.enqueue(encodeSse(block)),
    close: () => {
      try {
        controller.close();
      } catch {
        // Stream may already be closed.
      }
    },
  };
}

function createFetchMock(sse?: ReturnType<typeof createDeferredSseResponse>) {
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

    if (url.endsWith('/v1/listings')) {
      return jsonResponse({ listings: [listing] });
    }

    if (url.endsWith('/v1/quotes') && method === 'POST') {
      return jsonResponse({ quote });
    }

    if (url.endsWith('/v1/escrows') && method === 'POST') {
      return jsonResponse({ escrow });
    }

    if (url.includes('/deposit') && method === 'POST') {
      return jsonResponse({ escrow: { ...escrow, status: 'funded' } });
    }

    if (url.includes('/fiat-receipt') && method === 'POST') {
      return jsonResponse({ escrow: { ...escrow, status: 'active' } });
    }

    if (url.includes('/v1/test/escrows/')) {
      return jsonResponse({ escrow: { ...escrow, status: 'released' } });
    }

    if (url.includes('/v1/escrows/events')) {
      if (sse) {
        return sse.response();
      }
      return sseResponse([]);
    }

    return jsonResponse({ error: 'not found' }, 404);
  });
}

describe('PactoCheckout', () => {
  let defaultSse: ReturnType<typeof createDeferredSseResponse>;

  beforeEach(() => {
    defaultSse = createDeferredSseResponse();
    vi.stubGlobal('fetch', createFetchMock(defaultSse));
  });

  afterEach(() => {
    defaultSse.close();
    cleanup();
    vi.unstubAllGlobals();
  });

  it('completes buy flow end-to-end and calls onComplete', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const sse = createDeferredSseResponse();

    vi.stubGlobal('fetch', createFetchMock(sse));

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        open
        onClose={() => {}}
        onComplete={onComplete}
        testMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));

    await waitFor(() => {
      expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Payment reference'), 'REF-123');
    await user.click(screen.getByRole('button', { name: 'Submit receipt' }));

    await waitFor(() => {
      expect(screen.getByTestId('tracking-step')).toBeInTheDocument();
    });

    sse.push(
      'id: cursor-1\nevent: released\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
    );
    sse.close();

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));
    });

    expect(screen.getByTestId('checkout-success')).toBeInTheDocument();
  });

  it('calls onDispute when escrow is disputed', async () => {
    const onDispute = vi.fn();
    const user = userEvent.setup();
    const sse = createDeferredSseResponse();

    vi.stubGlobal('fetch', createFetchMock(sse));

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        open
        onClose={() => {}}
        onDispute={onDispute}
        testMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));
    await waitFor(() => {
      expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Payment reference'), 'REF-456');
    await user.click(screen.getByRole('button', { name: 'Submit receipt' }));

    await waitFor(() => {
      expect(screen.getByTestId('tracking-step')).toBeInTheDocument();
    });

    sse.push(
      'id: cursor-1\nevent: disputed\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
    );
    sse.close();

    await waitFor(() => {
      expect(onDispute).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));
    });

    expect(screen.getByTestId('checkout-disputed')).toBeInTheDocument();
  });

  it('shows error state when session creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid_key', message: 'Bad key' }, 401)),
    );

    const onError = vi.fn();

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        open
        onClose={() => {}}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkout-error')).toBeInTheDocument();
    });

    expect(onError).toHaveBeenCalled();
  });

  it('lists listings when no listingId is provided', async () => {
    const user = userEvent.setup();

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        open
        onClose={() => {}}
        testMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('listing-list')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /USDC/ }));

    await waitFor(() => {
      expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('renders dialog with ARIA attributes', async () => {
      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      const dialog = await screen.findByTestId('pacto-checkout-dialog');
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'pacto-checkout-title');
    });

    it('closes on Escape key', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();

      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={onClose}
        />,
      );

      await screen.findByTestId('pacto-checkout-dialog');
      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    it('traps focus within the dialog on Tab', async () => {
      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      const dialog = await screen.findByTestId('pacto-checkout-dialog');
      const closeButton = screen.getByRole('button', { name: 'Close checkout' });
      const confirmButton = await screen.findByRole('button', { name: 'Confirm deposit' });

      expect(closeButton).toHaveFocus();

      await userEvent.tab();
      expect(confirmButton).toHaveFocus();

      await userEvent.tab();
      expect(closeButton).toHaveFocus();
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  describe('test mode', () => {
    it('shows TEST MODE banner for pk_test_ keys', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkout-test-banner')).toBeInTheDocument();
      });

      expect(screen.getByTestId('checkout-test-banner')).toHaveTextContent(
        'TEST MODE — no real funds or Stellar transactions',
      );
    });

    it('does not show TEST MODE banner for pk_live_ keys', async () => {
      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('checkout-test-banner')).not.toBeInTheDocument();
    });

    it('invokes api.test controls when simulator buttons are clicked', async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkout-simulator-controls')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Force release' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/v1/test/escrows/esc_1/release'),
          expect.objectContaining({ method: 'POST' }),
        );
      });

      await user.click(screen.getByRole('button', { name: 'Force dispute' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/v1/test/escrows/esc_1/dispute'),
          expect.objectContaining({ method: 'POST' }),
        );
      });

      await user.click(screen.getByRole('button', { name: 'Force timeout' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/v1/test/escrows/esc_1/timeout'),
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });
  });
});
