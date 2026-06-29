import {
  type CheckoutMode,
  Pacto,
  type PactoClient,
  type PactoSession,
  type PactoSessionData,
} from './client.js';
import type { EscrowEvent } from './escrow-events.js';
import { isTestMode } from './keys.js';
import type { Escrow, Listing, PactoApiClient, Quote } from './resources.js';

export type CheckoutStep =
  | 'loading'
  | 'selectListing'
  | 'deposit'
  | 'uploadReceipt'
  | 'tracking'
  | 'success'
  | 'disputed'
  | 'error';

export interface CheckoutFlowState {
  step: CheckoutStep;
  sessionId: string | null;
  listings: Listing[];
  selectedListing: Listing | null;
  escrow: Escrow | null;
  quote: Quote | null;
  error: Error | null;
  milestones: EscrowEvent[];
  testMode: boolean;
}

export interface CheckoutFlowOptions {
  publishableKey: string;
  gatewayUrl?: string;
  listingId?: string;
  mode?: CheckoutMode;
  testMode?: boolean;
  /** Pre-created session; skips POST /v1/session when provided. */
  session?: PactoSessionData;
  onChange?: (state: CheckoutFlowState) => void;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
}

const INITIAL_STATE: CheckoutFlowState = {
  step: 'loading',
  sessionId: null,
  listings: [],
  selectedListing: null,
  escrow: null,
  quote: null,
  error: null,
  milestones: [],
  testMode: false,
};

export class CheckoutFlowController {
  private state: CheckoutFlowState = { ...INITIAL_STATE };
  private session: PactoSession | null = null;
  private client: PactoClient | null = null;
  private api: PactoApiClient | null = null;
  private escrow: Escrow | null = null;
  private eventsBound = false;
  private destroyed = false;

  constructor(private readonly options: CheckoutFlowOptions) {}

  getState(): CheckoutFlowState {
    return this.state;
  }

  async start(): Promise<void> {
    await this.initialize();
  }

  destroy(): void {
    this.destroyed = true;
    this.session?.closeEvents();
    this.session = null;
    this.client = null;
    this.api = null;
    this.escrow = null;
    this.eventsBound = false;
  }

  async selectListing(listing: Listing): Promise<void> {
    this.patchState({ selectedListing: listing, step: 'loading' });
    try {
      await this.createQuoteAndEscrow(listing);
    } catch (err) {
      this.handleError(err);
    }
  }

  async confirmDeposit(): Promise<void> {
    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    this.patchState({ step: 'loading' });
    try {
      const response = await api.escrows.deposit(currentEscrow.id, {
        testMode: this.options.testMode ?? true,
      });
      this.escrow = response.escrow;
      this.patchState({ escrow: response.escrow, step: 'uploadReceipt' });
    } catch (err) {
      this.handleError(err);
    }
  }

  async submitReceipt(
    method: 'SINPE' | 'SPEI',
    reference: string,
    receipt?: string,
  ): Promise<void> {
    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    this.patchState({ step: 'loading' });
    try {
      const response = await api.escrows.reportFiatPayment(currentEscrow.id, {
        method,
        reference,
        receipt,
      });
      this.escrow = response.escrow;
      this.bindEscrowEvents();
      this.patchState({ escrow: response.escrow, step: 'tracking' });
    } catch (err) {
      this.handleError(err);
    }
  }

  retry(): void {
    void this.initialize();
  }

  async forceTestRelease(): Promise<void> {
    if (!this.state.testMode) {
      return;
    }

    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    try {
      await api.test.forceRelease(currentEscrow.id);
    } catch (err) {
      this.handleError(err);
    }
  }

  async forceTestDispute(reason?: string): Promise<void> {
    if (!this.state.testMode) {
      return;
    }

    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    try {
      await api.test.forceDispute(currentEscrow.id, reason ? { reason } : undefined);
    } catch (err) {
      this.handleError(err);
    }
  }

  async forceTestTimeout(): Promise<void> {
    if (!this.state.testMode) {
      return;
    }

    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    try {
      await api.test.forceTimeout(currentEscrow.id);
    } catch (err) {
      this.handleError(err);
    }
  }

  private patchState(partial: Partial<CheckoutFlowState>): void {
    if (this.destroyed) {
      return;
    }

    this.state = { ...this.state, ...partial };
    this.options.onChange?.(this.state);
  }

  private handleError(err: unknown): void {
    const normalized = err instanceof Error ? err : new Error(String(err));
    this.patchState({ error: normalized, step: 'error' });
    this.options.onError?.(normalized);
  }

  private bindEscrowEvents(): void {
    const session = this.session;
    const currentEscrow = this.escrow;
    if (!session || !currentEscrow || this.eventsBound) {
      return;
    }

    this.eventsBound = true;
    const escrowId = currentEscrow.id;

    const trackMilestone = (event: EscrowEvent) => {
      this.patchState({ milestones: [...this.state.milestones, event] });
    };

    session.on(
      'released',
      (event) => {
        trackMilestone(event);
        this.patchState({ step: 'success' });
        this.options.onComplete?.(currentEscrow);
      },
      { escrowId },
    );

    session.on(
      'disputed',
      (event) => {
        trackMilestone(event);
        this.patchState({ step: 'disputed' });
        this.options.onDispute?.(currentEscrow);
      },
      { escrowId },
    );

    session.on('escrow.funded', trackMilestone, { escrowId });
    session.on('fiat.reported', trackMilestone, { escrowId });
  }

  private async createQuoteAndEscrow(listing: Listing): Promise<void> {
    const api = this.api;
    if (!api) {
      throw new Error('API client not initialized');
    }

    const quoteResponse = await api.quotes.create({
      listingId: listing.id,
      asset: listing.asset,
      amount: listing.amount,
      price: listing.price,
      side: 'buy',
    });

    const escrowResponse = await api.escrows.create({ quoteId: quoteResponse.quote.id });
    this.escrow = escrowResponse.escrow;
    this.patchState({
      quote: quoteResponse.quote,
      escrow: escrowResponse.escrow,
      step: 'deposit',
    });
  }

  private async initialize(): Promise<void> {
    this.state = {
      ...INITIAL_STATE,
      testMode: isTestMode(this.options.publishableKey),
    };
    this.eventsBound = false;
    this.escrow = null;
    this.options.onChange?.(this.state);

    try {
      const client = Pacto.init({
        publishableKey: this.options.publishableKey,
        gatewayUrl: this.options.gatewayUrl,
      });
      this.client = client;

      const mode = this.options.mode ?? 'buy';
      const session = this.options.session
        ? client.resumeCheckoutSession(this.options.session)
        : this.options.listingId
          ? await client.createCheckoutSession({ listingId: this.options.listingId, mode })
          : await client.createCheckoutSession({ quote: { browse: true }, mode });

      this.session = session;
      this.api = client.api(session);
      this.patchState({ sessionId: session.sessionId });

      if (this.options.listingId) {
        const listingResponse = await this.api.listings.retrieve(this.options.listingId);
        this.patchState({ selectedListing: listingResponse.listing });
        await this.createQuoteAndEscrow(listingResponse.listing);
        return;
      }

      const listingsResponse = await this.api.listings.list();
      this.patchState({ listings: listingsResponse.listings, step: 'selectListing' });
    } catch (err) {
      this.handleError(err);
    }
  }
}
