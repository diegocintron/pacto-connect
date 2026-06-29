import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWebhookEndpoint = {
  id: 'wh_ep_1',
  apiKeyId: 'key_1',
  url: 'https://example.com/webhook',
  secret: 'whsec_stored_secret',
  enabledEvents: ['escrow.created'],
  status: 'enabled' as const,
  verified: false,
  description: null,
  createdAt: new Date('2024-06-01T12:00:00.000Z'),
  updatedAt: new Date('2024-06-01T12:00:00.000Z'),
};

vi.mock('../db.js', () => ({
  prisma: {
    webhookEndpoint: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('./transport.js', () => ({
  postSignedWebhook: vi.fn(),
}));

import type { WebhookEndpoint } from '@prisma/client';
import { prisma } from '../db.js';
import {
  listEndpoints,
  registerEndpoint,
  validateEndpointInput,
  verifyEndpoint,
  WebhookValidationError,
} from './endpoints.js';
import { postSignedWebhook } from './transport.js';

describe('webhook endpoints service', () => {
  beforeEach(() => {
    vi.mocked(prisma.webhookEndpoint.create).mockReset();
    vi.mocked(prisma.webhookEndpoint.findMany).mockReset();
    vi.mocked(prisma.webhookEndpoint.findUnique).mockReset();
    vi.mocked(prisma.webhookEndpoint.update).mockReset();
    vi.mocked(prisma.webhookEndpoint.delete).mockReset();
    vi.mocked(postSignedWebhook).mockReset();
  });

  it('registerEndpoint returns a whsec_ secret', async () => {
    vi.mocked(prisma.webhookEndpoint.create).mockResolvedValue({
      ...mockWebhookEndpoint,
      id: 'wh_ep_new',
    } as WebhookEndpoint);

    const result = await registerEndpoint({
      apiKeyId: 'key_1',
      url: 'https://example.com/webhook',
      enabledEvents: ['escrow.created'],
    });

    const createCall = vi.mocked(prisma.webhookEndpoint.create).mock.calls[0]![0];
    expect(createCall.data.secret).toMatch(/^whsec_[A-Za-z0-9_-]+$/);
    expect(result.secret).toBe(createCall.data.secret);
    expect(result.secret).toMatch(/^whsec_[A-Za-z0-9_-]+$/);
    expect(result.id).toBe('wh_ep_new');
  });

  it('listEndpoints never exposes the secret', async () => {
    vi.mocked(prisma.webhookEndpoint.findMany).mockResolvedValue([
      mockWebhookEndpoint as WebhookEndpoint,
    ]);

    const endpoints = await listEndpoints('key_1');

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).not.toHaveProperty('secret');
    expect(Object.keys(endpoints[0]!)).not.toContain('secret');
  });

  it('validateEndpointInput rejects a non-http URL', () => {
    expect(() =>
      validateEndpointInput({
        apiKeyId: 'key_1',
        url: 'ftp://example.com/hook',
        enabledEvents: ['escrow.created'],
      }),
    ).toThrow(new WebhookValidationError('url must be a valid http(s) URL'));
  });

  it('validateEndpointInput rejects an empty enabledEvents array', () => {
    expect(() =>
      validateEndpointInput({
        apiKeyId: 'key_1',
        url: 'https://example.com/hook',
        enabledEvents: [],
      }),
    ).toThrow(new WebhookValidationError('enabledEvents must be a non-empty array'));
  });

  it('validateEndpointInput rejects an unknown event type', () => {
    expect(() =>
      validateEndpointInput({
        apiKeyId: 'key_1',
        url: 'https://example.com/hook',
        enabledEvents: ['not.a.real.event'],
      }),
    ).toThrow(new WebhookValidationError('unknown event type: not.a.real.event'));
  });

  it('verifyEndpoint marks verified when the endpoint echoes the challenge', async () => {
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue(
      mockWebhookEndpoint as WebhookEndpoint,
    );
    vi.mocked(postSignedWebhook).mockImplementation(async (_url, body) => {
      const payload = JSON.parse(body) as { data: { challenge: string } };
      return {
        ok: true,
        status: 200,
        bodyText: JSON.stringify({ challenge: payload.data.challenge }),
      };
    });
    vi.mocked(prisma.webhookEndpoint.update).mockResolvedValue({
      ...mockWebhookEndpoint,
      verified: true,
    } as WebhookEndpoint);

    const result = await verifyEndpoint('wh_ep_1');

    expect(result).toEqual({ verified: true, status: 200 });
    expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith({
      where: { id: 'wh_ep_1' },
      data: { verified: true },
    });
  });

  it('verifyEndpoint returns verified:false when the echo does not match', async () => {
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue(
      mockWebhookEndpoint as WebhookEndpoint,
    );
    vi.mocked(postSignedWebhook).mockResolvedValue({
      ok: true,
      status: 200,
      bodyText: JSON.stringify({ challenge: 'wrong-challenge' }),
    });

    const result = await verifyEndpoint('wh_ep_1');

    expect(result).toEqual({
      verified: false,
      status: 200,
      error: 'endpoint did not echo challenge',
    });
    expect(prisma.webhookEndpoint.update).not.toHaveBeenCalled();
  });

  it('verifyEndpoint returns null when the endpoint is missing', async () => {
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue(null);

    const result = await verifyEndpoint('missing');

    expect(result).toBeNull();
    expect(postSignedWebhook).not.toHaveBeenCalled();
  });
});
