import { type HttpClientOptions, request } from './http.js';

export type EscrowStatus = 'pending' | 'active' | 'funded' | 'released' | 'cancelled' | 'disputed';

export interface Listing {
  id: string;
  asset: string;
  amount: string;
  price: string;
  side: 'buy' | 'sell';
  status: string;
  createdAt: string;
}

export interface Quote {
  id: string;
  listingId?: string;
  asset: string;
  amount: string;
  price: string;
  side: 'buy' | 'sell';
  expiresAt: string;
  createdAt: string;
}

export interface CreateQuoteParams {
  listingId?: string;
  asset: string;
  amount: string;
  price: string;
  side: 'buy' | 'sell';
}

export interface Escrow {
  id: string;
  quoteId: string;
  status: EscrowStatus;
  amount: string;
  asset: string;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowStatusResponse {
  id: string;
  status: EscrowStatus;
  updatedAt: string;
}

export interface CreateEscrowParams {
  quoteId: string;
}

export interface ListingsResource {
  list(): Promise<{ listings: Listing[] }>;
  retrieve(id: string): Promise<{ listing: Listing }>;
}

export interface QuotesResource {
  create(params: CreateQuoteParams): Promise<{ quote: Quote }>;
  retrieve(id: string): Promise<{ quote: Quote }>;
}

export interface EscrowsResource {
  create(params: CreateEscrowParams): Promise<{ escrow: Escrow }>;
  retrieve(id: string): Promise<{ escrow: Escrow }>;
  getStatus(id: string): Promise<{ status: EscrowStatusResponse }>;
}

export interface PactoApiClient {
  readonly listings: ListingsResource;
  readonly quotes: QuotesResource;
  readonly escrows: EscrowsResource;
}

export function createApiClient(options: HttpClientOptions): PactoApiClient {
  return {
    listings: {
      list: () =>
        request<{ listings: Listing[] }>(options, { method: 'GET', path: '/v1/listings' }),
      retrieve: (id) =>
        request<{ listing: Listing }>(options, {
          method: 'GET',
          path: `/v1/listings/${id}`,
          resource: 'listing',
        }),
    },
    quotes: {
      create: (params) =>
        request<{ quote: Quote }>(options, {
          method: 'POST',
          path: '/v1/quotes',
          body: params,
          idempotent: true,
          resource: 'quote',
        }),
      retrieve: (id) =>
        request<{ quote: Quote }>(options, {
          method: 'GET',
          path: `/v1/quotes/${id}`,
          resource: 'quote',
        }),
    },
    escrows: {
      create: (params) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: '/v1/escrows',
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
      retrieve: (id) =>
        request<{ escrow: Escrow }>(options, {
          method: 'GET',
          path: `/v1/escrows/${id}`,
          resource: 'escrow',
        }),
      getStatus: (id) =>
        request<{ status: EscrowStatusResponse }>(options, {
          method: 'GET',
          path: `/v1/escrows/${id}/status`,
          resource: 'escrow',
        }),
    },
  };
}
