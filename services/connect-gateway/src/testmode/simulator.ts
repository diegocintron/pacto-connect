import { randomUUID } from 'node:crypto';
import type { EscrowEventName, EscrowMilestone } from '@pacto-connect/core';

export type EscrowStatus = 'pending' | 'funded' | 'released' | 'disputed' | 'cancelled';

export type SimulatorErrorCode = 'escrow_not_found' | 'invalid_transition';

export class SimulatorError extends Error {
  constructor(
    public readonly code: SimulatorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SimulatorError';
  }
}

const MILESTONE_BY_EVENT: Record<EscrowEventName, EscrowMilestone> = {
  'escrow.funded': 'funded',
  'fiat.reported': 'fiat_reported',
  released: 'released',
  disputed: 'disputed',
};

export interface SimulatorEscrow {
  id: string;
  quoteId: string;
  apiKeyId: string;
  sessionId: string;
  status: EscrowStatus;
  amount: string;
  asset: string;
  createdAt: string;
  updatedAt: string;
}

export interface SimulatorEvent {
  cursor: string;
  type: EscrowEventName;
  escrowId: string;
  milestone: EscrowMilestone;
  occurredAt: string;
  data?: Record<string, unknown>;
}

type EventListener = (event: SimulatorEvent) => void;

interface EscrowRecord {
  id: string;
  quoteId: string;
  apiKeyId: string;
  sessionId: string;
  status: EscrowStatus;
  amount: string;
  asset: string;
  createdAt: string;
  updatedAt: string;
  fiatReported: boolean;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

function getReleaseDelayMs(): number {
  const configured = process.env.TESTMODE_RELEASE_DELAY_MS;
  if (!configured) {
    return 3000;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 3000;
  }

  return parsed;
}

function escrowKey(apiKeyId: string, sessionId: string, escrowId: string): string {
  return `${apiKeyId}:${sessionId}:${escrowId}`;
}

function toPublicEscrow(record: EscrowRecord): SimulatorEscrow {
  return {
    id: record.id,
    quoteId: record.quoteId,
    apiKeyId: record.apiKeyId,
    sessionId: record.sessionId,
    status: record.status,
    amount: record.amount,
    asset: record.asset,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

class EscrowSimulator {
  private escrows = new Map<string, EscrowRecord>();
  private events: SimulatorEvent[] = [];
  private eventCounter = 0;
  private listeners = new Set<{
    sessionId: string;
    escrowId?: string;
    listener: EventListener;
  }>();

  reset(): void {
    for (const record of this.escrows.values()) {
      if (record.releaseTimer) {
        clearTimeout(record.releaseTimer);
      }
    }

    this.escrows.clear();
    this.events = [];
    this.eventCounter = 0;
    this.listeners.clear();
  }

  subscribe(sessionId: string, escrowId: string | undefined, listener: EventListener): () => void {
    const entry = { sessionId, escrowId, listener };
    this.listeners.add(entry);

    return () => {
      this.listeners.delete(entry);
    };
  }

  createEscrow(input: {
    apiKeyId: string;
    sessionId: string;
    quoteId: string;
    amount: string;
    asset: string;
  }): SimulatorEscrow {
    const now = new Date().toISOString();
    const id = `esc_${randomUUID()}`;
    const record: EscrowRecord = {
      id,
      quoteId: input.quoteId,
      apiKeyId: input.apiKeyId,
      sessionId: input.sessionId,
      status: 'pending',
      amount: input.amount,
      asset: input.asset,
      createdAt: now,
      updatedAt: now,
      fiatReported: false,
    };

    this.escrows.set(escrowKey(input.apiKeyId, input.sessionId, id), record);
    return toPublicEscrow(record);
  }

  getEscrow(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    return toPublicEscrow(record);
  }

  getStatus(sessionId: string, id: string, apiKeyId?: string): EscrowStatus {
    return this.findEscrow(sessionId, id, apiKeyId).status;
  }

  deposit(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);

    if (record.status !== 'pending') {
      throw new SimulatorError(
        'invalid_transition',
        `Cannot deposit escrow in status ${record.status}`,
      );
    }

    record.status = 'funded';
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'escrow.funded');
    return toPublicEscrow(record);
  }

  reportFiat(
    sessionId: string,
    id: string,
    input: { method: string; reference: string; receipt?: string },
    apiKeyId?: string,
  ): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);

    if (record.status !== 'funded') {
      throw new SimulatorError(
        'invalid_transition',
        `Cannot report fiat for escrow in status ${record.status}`,
      );
    }

    if (record.fiatReported) {
      throw new SimulatorError(
        'invalid_transition',
        'Fiat payment already reported for this escrow',
      );
    }

    record.fiatReported = true;
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'fiat.reported', {
      method: input.method,
      reference: input.reference,
      ...(input.receipt !== undefined ? { receipt: input.receipt } : {}),
    });

    this.scheduleRelease(record);
    return toPublicEscrow(record);
  }

  forceRelease(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);

    if (record.status !== 'funded') {
      throw new SimulatorError(
        'invalid_transition',
        `Cannot release escrow in status ${record.status}`,
      );
    }

    this.cancelReleaseTimer(record);
    record.status = 'released';
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'released');
    return toPublicEscrow(record);
  }

  forceDispute(sessionId: string, id: string, reason?: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);

    if (record.status !== 'funded') {
      throw new SimulatorError(
        'invalid_transition',
        `Cannot dispute escrow in status ${record.status}`,
      );
    }

    this.cancelReleaseTimer(record);
    record.status = 'disputed';
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'disputed', { reason: reason ?? 'manual' });
    return toPublicEscrow(record);
  }

  forceTimeout(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);

    if (record.status !== 'funded') {
      throw new SimulatorError(
        'invalid_transition',
        `Cannot timeout escrow in status ${record.status}`,
      );
    }

    this.cancelReleaseTimer(record);
    record.status = 'disputed';
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'disputed', { reason: 'timeout' });
    return toPublicEscrow(record);
  }

  getEventsSince(
    sessionId: string,
    escrowId: string | undefined,
    cursor: string | undefined,
    apiKeyId?: string,
  ): SimulatorEvent[] {
    return this.events.filter((event) => {
      const record = this.findEscrowById(event.escrowId);
      if (!record || record.sessionId !== sessionId) {
        return false;
      }

      if (apiKeyId && record.apiKeyId !== apiKeyId) {
        return false;
      }

      if (escrowId && event.escrowId !== escrowId) {
        return false;
      }

      if (cursor && event.cursor <= cursor) {
        return false;
      }

      return true;
    });
  }

  private findEscrowById(escrowId: string): EscrowRecord | undefined {
    for (const record of this.escrows.values()) {
      if (record.id === escrowId) {
        return record;
      }
    }

    return undefined;
  }

  private findEscrow(sessionId: string, id: string, apiKeyId?: string): EscrowRecord {
    for (const record of this.escrows.values()) {
      if (record.id !== id || record.sessionId !== sessionId) {
        continue;
      }

      if (apiKeyId && record.apiKeyId !== apiKeyId) {
        continue;
      }

      return record;
    }

    throw new SimulatorError('escrow_not_found', `Escrow ${id} not found`);
  }

  private nextCursor(): string {
    this.eventCounter += 1;
    return `evt_${String(this.eventCounter).padStart(6, '0')}`;
  }

  private emitEvent(
    record: EscrowRecord,
    type: EscrowEventName,
    data?: Record<string, unknown>,
  ): SimulatorEvent {
    const event: SimulatorEvent = {
      cursor: this.nextCursor(),
      type,
      escrowId: record.id,
      milestone: MILESTONE_BY_EVENT[type],
      occurredAt: new Date().toISOString(),
      ...(data ? { data } : {}),
    };

    this.events.push(event);

    for (const entry of this.listeners) {
      if (entry.sessionId !== record.sessionId) {
        continue;
      }

      if (entry.escrowId && entry.escrowId !== event.escrowId) {
        continue;
      }

      entry.listener(event);
    }

    return event;
  }

  private cancelReleaseTimer(record: EscrowRecord): void {
    if (record.releaseTimer) {
      clearTimeout(record.releaseTimer);
      record.releaseTimer = undefined;
    }
  }

  private scheduleRelease(record: EscrowRecord): void {
    this.cancelReleaseTimer(record);

    record.releaseTimer = setTimeout(() => {
      record.releaseTimer = undefined;

      if (record.status !== 'funded') {
        return;
      }

      record.status = 'released';
      record.updatedAt = new Date().toISOString();
      this.emitEvent(record, 'released');
    }, getReleaseDelayMs());
  }
}

let simulatorInstance: EscrowSimulator | undefined;

export function getSimulator(): EscrowSimulator {
  if (!simulatorInstance) {
    simulatorInstance = new EscrowSimulator();
  }

  return simulatorInstance;
}

export function resetSimulator(): void {
  if (simulatorInstance) {
    simulatorInstance.reset();
  }
}
