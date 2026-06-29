import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSimulator, resetSimulator, SimulatorError } from './simulator.js';

describe('EscrowSimulator', () => {
  beforeEach(() => {
    resetSimulator();
    vi.useFakeTimers();
    process.env.TESTMODE_RELEASE_DELAY_MS = '3000';
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSimulator();
  });

  it('runs the full lifecycle with auto release after fiat report', () => {
    const simulator = getSimulator();
    const escrow = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '250',
      asset: 'USDC',
    });

    expect(escrow.status).toBe('pending');

    const funded = simulator.deposit('session_1', escrow.id, 'key_1');
    expect(funded.status).toBe('funded');

    const reported = simulator.reportFiat(
      'session_1',
      escrow.id,
      { method: 'SINPE', reference: 'ref-123' },
      'key_1',
    );
    expect(reported.status).toBe('funded');

    const eventsBeforeRelease = simulator.getEventsSince(
      'session_1',
      escrow.id,
      undefined,
      'key_1',
    );
    expect(eventsBeforeRelease.map((event) => event.type)).toEqual([
      'escrow.funded',
      'fiat.reported',
    ]);
    expect(eventsBeforeRelease[1]?.milestone).toBe('fiat_reported');

    vi.advanceTimersByTime(2999);
    expect(simulator.getStatus('session_1', escrow.id, 'key_1')).toBe('funded');

    vi.advanceTimersByTime(1);
    expect(simulator.getStatus('session_1', escrow.id, 'key_1')).toBe('released');

    const allEvents = simulator.getEventsSince('session_1', escrow.id, undefined, 'key_1');
    expect(allEvents.map((event) => event.type)).toEqual([
      'escrow.funded',
      'fiat.reported',
      'released',
    ]);
  });

  it('forceDispute cancels pending release and emits disputed event', () => {
    const simulator = getSimulator();
    const escrow = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '100',
      asset: 'USDC',
    });

    simulator.deposit('session_1', escrow.id, 'key_1');
    simulator.reportFiat('session_1', escrow.id, { method: 'SPEI', reference: 'ref-456' }, 'key_1');

    const disputed = simulator.forceDispute('session_1', escrow.id, 'buyer_claim', 'key_1');
    expect(disputed.status).toBe('disputed');

    vi.advanceTimersByTime(5000);
    expect(simulator.getStatus('session_1', escrow.id, 'key_1')).toBe('disputed');

    const events = simulator.getEventsSince('session_1', escrow.id, undefined, 'key_1');
    expect(events.at(-1)).toMatchObject({
      type: 'disputed',
      milestone: 'disputed',
      data: { reason: 'buyer_claim' },
    });
  });

  it('forceTimeout emits disputed event with timeout reason', () => {
    const simulator = getSimulator();
    const escrow = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '100',
      asset: 'USDC',
    });

    simulator.deposit('session_1', escrow.id, 'key_1');
    simulator.reportFiat(
      'session_1',
      escrow.id,
      { method: 'SINPE', reference: 'ref-789' },
      'key_1',
    );

    const disputed = simulator.forceTimeout('session_1', escrow.id, 'key_1');
    expect(disputed.status).toBe('disputed');

    const events = simulator.getEventsSince('session_1', escrow.id, undefined, 'key_1');
    expect(events.at(-1)).toMatchObject({
      type: 'disputed',
      data: { reason: 'timeout' },
    });
  });

  it('forceRelease cancels pending timer and releases immediately', () => {
    const simulator = getSimulator();
    const escrow = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '100',
      asset: 'USDC',
    });

    simulator.deposit('session_1', escrow.id, 'key_1');
    simulator.reportFiat(
      'session_1',
      escrow.id,
      { method: 'SINPE', reference: 'ref-000' },
      'key_1',
    );

    const released = simulator.forceRelease('session_1', escrow.id, 'key_1');
    expect(released.status).toBe('released');

    vi.advanceTimersByTime(5000);
    expect(simulator.getStatus('session_1', escrow.id, 'key_1')).toBe('released');
  });

  it('rejects invalid transitions', () => {
    const simulator = getSimulator();
    const escrow = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '100',
      asset: 'USDC',
    });

    expect(() => simulator.deposit('session_1', escrow.id, 'key_1')).not.toThrow();
    expect(() => simulator.deposit('session_1', escrow.id, 'key_1')).toThrow(SimulatorError);
    expect(() => simulator.deposit('session_1', escrow.id, 'key_1')).toThrow(
      expect.objectContaining({ code: 'invalid_transition' }),
    );

    expect(() => simulator.forceRelease('session_1', 'missing', 'key_1')).toThrow(
      expect.objectContaining({ code: 'escrow_not_found' }),
    );
  });

  it('supports event log replay with monotonic cursors', () => {
    const simulator = getSimulator();
    const escrow = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '100',
      asset: 'USDC',
    });

    simulator.deposit('session_1', escrow.id, 'key_1');
    simulator.reportFiat(
      'session_1',
      escrow.id,
      { method: 'SINPE', reference: 'ref-111' },
      'key_1',
    );

    const allEvents = simulator.getEventsSince('session_1', undefined, undefined, 'key_1');
    expect(allEvents[0]?.cursor).toBe('evt_000001');
    expect(allEvents[1]?.cursor).toBe('evt_000002');
    expect(allEvents[0]?.cursor.localeCompare(allEvents[1]?.cursor ?? '')).toBeLessThan(0);

    const afterFirst = simulator.getEventsSince(
      'session_1',
      undefined,
      allEvents[0]?.cursor,
      'key_1',
    );
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.type).toBe('fiat.reported');
  });

  it('isolates escrows by session', () => {
    const simulator = getSimulator();
    const escrowOne = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '100',
      asset: 'USDC',
    });
    const escrowTwo = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_2',
      quoteId: 'quote_2',
      amount: '200',
      asset: 'USDC',
    });

    simulator.deposit('session_1', escrowOne.id, 'key_1');

    expect(() => simulator.getEscrow('session_2', escrowOne.id, 'key_1')).toThrow(
      expect.objectContaining({ code: 'escrow_not_found' }),
    );
    expect(simulator.getEscrow('session_2', escrowTwo.id, 'key_1').status).toBe('pending');
  });

  it('notifies subscribers for matching session and escrow filters', () => {
    const simulator = getSimulator();
    const escrow = simulator.createEscrow({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      amount: '100',
      asset: 'USDC',
    });

    const received: string[] = [];
    const unsubscribe = simulator.subscribe('session_1', escrow.id, (event) => {
      received.push(event.type);
    });

    simulator.deposit('session_1', escrow.id, 'key_1');
    expect(received).toEqual(['escrow.funded']);

    unsubscribe();
    simulator.reportFiat(
      'session_1',
      escrow.id,
      { method: 'SINPE', reference: 'ref-222' },
      'key_1',
    );
    expect(received).toEqual(['escrow.funded']);
  });
});
