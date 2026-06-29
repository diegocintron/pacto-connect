export const WEBHOOK_EVENT_TYPES = [
  'escrow.created',
  'trade.completed',
  'dispute.opened',
  'payment.reported',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

// Reserved system event used to verify an endpoint owns its URL. Not subscribable.
export const WEBHOOK_VERIFICATION_EVENT = 'endpoint.verification';
