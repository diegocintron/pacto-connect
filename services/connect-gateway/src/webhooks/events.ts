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
