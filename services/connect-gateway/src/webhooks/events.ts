import type { Prisma } from '@prisma/client';
import { type DispatchResult, dispatchEvent } from './delivery.js';

// NOTE (multi-merchant): the escrow-lifecycle emitters below are currently
// dormant (no callers; live escrow webhooks are not wired yet). When live
// escrow webhooks are implemented, thread the escrow's `merchantId` through to
// `dispatchEvent({ ..., merchantId })` — otherwise these events would leak to
// platform-level endpoints instead of the sub-merchant's. See MULTI_MERCHANT.md.
export const emitEscrowCreated = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'escrow.created', data });

export const emitTradeCompleted = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'trade.completed', data });

export const emitDisputeOpened = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'dispute.opened', data });

export const emitPaymentReported = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'payment.reported', data });

export const emitSubscriptionCreated = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
  merchantId?: string,
): Promise<DispatchResult> =>
  dispatchEvent({ apiKeyId, merchantId, type: 'subscription.created', data });

export const emitSubscriptionCharged = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
  merchantId?: string,
): Promise<DispatchResult> =>
  dispatchEvent({ apiKeyId, merchantId, type: 'subscription.charged', data });

export const emitSubscriptionFailed = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
  merchantId?: string,
): Promise<DispatchResult> =>
  dispatchEvent({ apiKeyId, merchantId, type: 'subscription.failed', data });

export const emitSubscriptionCanceled = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
  merchantId?: string,
): Promise<DispatchResult> =>
  dispatchEvent({ apiKeyId, merchantId, type: 'subscription.canceled', data });
