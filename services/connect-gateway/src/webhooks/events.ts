import type { Prisma } from '@prisma/client';
import { type DispatchResult, dispatchEvent } from './delivery.js';

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
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'subscription.created', data });

export const emitSubscriptionCharged = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'subscription.charged', data });

export const emitSubscriptionFailed = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'subscription.failed', data });

export const emitSubscriptionCanceled = (
  apiKeyId: string,
  data: Prisma.InputJsonValue,
): Promise<DispatchResult> => dispatchEvent({ apiKeyId, type: 'subscription.canceled', data });
