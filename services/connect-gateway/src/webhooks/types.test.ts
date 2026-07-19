import { describe, expect, it } from 'vitest';
import { isWebhookEventType, WEBHOOK_EVENT_TYPES } from './types.js';

describe('webhook event types', () => {
  it('includes the subscription lifecycle events', () => {
    expect(WEBHOOK_EVENT_TYPES).toContain('subscription.created');
    expect(WEBHOOK_EVENT_TYPES).toContain('subscription.charged');
    expect(WEBHOOK_EVENT_TYPES).toContain('subscription.failed');
    expect(WEBHOOK_EVENT_TYPES).toContain('subscription.canceled');
  });

  it('recognizes subscription.charged as a valid type', () => {
    expect(isWebhookEventType('subscription.charged')).toBe(true);
  });
});
