import type { EscrowEvent, FiatPaymentMethod } from '@pacto-connect/core';
import { useRef, useState } from 'react';
import { type CheckoutStep, useCheckoutFlow } from './hooks/useCheckoutFlow.js';
import { useFocusTrap } from './hooks/useFocusTrap.js';

export interface PactoCheckoutProps {
  publishableKey: string;
  gatewayUrl?: string;
  listingId?: string;
  mode?: 'buy' | 'sell';
  testMode?: boolean;
  open: boolean;
  onClose: () => void;
  onComplete?: (escrow: import('@pacto-connect/core').Escrow) => void;
  onDispute?: (escrow: import('@pacto-connect/core').Escrow) => void;
  onError?: (error: Error) => void;
}

function stepLabel(step: CheckoutStep): string {
  switch (step) {
    case 'selectListing':
      return 'Select a listing';
    case 'deposit':
      return 'Deposit to escrow';
    case 'uploadReceipt':
      return 'Upload payment receipt';
    case 'tracking':
      return 'Tracking escrow status';
    case 'success':
      return 'Payment complete';
    case 'disputed':
      return 'Escrow disputed';
    case 'error':
      return 'Checkout error';
    default:
      return 'Processing checkout';
  }
}

const SIMULATOR_STEPS: CheckoutStep[] = ['deposit', 'uploadReceipt', 'tracking'];

function showSimulatorControls(
  testMode: boolean,
  step: CheckoutStep,
  escrow: import('@pacto-connect/core').Escrow | null,
): boolean {
  return testMode && escrow !== null && SIMULATOR_STEPS.includes(step);
}

function milestoneLabel(type: EscrowEvent['type']): string {
  switch (type) {
    case 'escrow.funded':
      return 'Escrow funded';
    case 'fiat.reported':
      return 'Fiat payment reported';
    case 'released':
      return 'Funds released';
    case 'disputed':
      return 'Escrow disputed';
  }
}

export function PactoCheckout(props: PactoCheckoutProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const flow = useCheckoutFlow({
    publishableKey: props.publishableKey,
    gatewayUrl: props.gatewayUrl,
    listingId: props.listingId,
    mode: props.mode,
    testMode: props.testMode,
    enabled: props.open,
    onComplete: props.onComplete,
    onDispute: props.onDispute,
    onError: props.onError,
  });

  const [method, setMethod] = useState<FiatPaymentMethod>('SINPE');
  const [reference, setReference] = useState('');

  useFocusTrap(dialogRef, props.open, props.onClose);

  if (!props.open) {
    return null;
  }

  const titleId = 'pacto-checkout-title';

  return (
    <div className="pacto-checkout-overlay" data-testid="pacto-checkout-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pacto-checkout-dialog"
        data-testid="pacto-checkout-dialog"
        tabIndex={-1}
      >
        {flow.testMode && (
          <div
            className="pacto-checkout-test-banner"
            role="status"
            data-testid="checkout-test-banner"
          >
            TEST MODE — no real funds or Stellar transactions
          </div>
        )}

        <header className="pacto-checkout-header">
          <h2 id={titleId}>{stepLabel(flow.step)}</h2>
          <button type="button" onClick={props.onClose} aria-label="Close checkout">
            Close
          </button>
        </header>

        {flow.step === 'loading' && (
          <output aria-live="polite" data-testid="checkout-loading">
            Loading…
          </output>
        )}

        {flow.step === 'error' && (
          <div role="alert" data-testid="checkout-error">
            <p>{flow.error?.message ?? 'Something went wrong'}</p>
            <button type="button" onClick={flow.retry}>
              Retry
            </button>
          </div>
        )}

        {flow.step === 'selectListing' && (
          <ul role="listbox" aria-label="Available listings" data-testid="listing-list">
            {flow.listings.map((listing) => (
              <li key={listing.id}>
                <button type="button" onClick={() => flow.selectListing(listing)}>
                  {listing.asset} — {listing.amount} @ {listing.price}
                </button>
              </li>
            ))}
          </ul>
        )}

        {flow.step === 'deposit' && flow.escrow && (
          <div data-testid="deposit-step">
            <p>
              Deposit <strong>{flow.escrow.amount}</strong> {flow.escrow.asset} to the escrow
              contract.
            </p>
            <button type="button" onClick={() => flow.confirmDeposit()}>
              Confirm deposit
            </button>
          </div>
        )}

        {flow.step === 'uploadReceipt' && (
          <form
            data-testid="receipt-form"
            onSubmit={(event) => {
              event.preventDefault();
              flow.submitReceipt(method, reference);
            }}
          >
            <label>
              Payment method
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as FiatPaymentMethod)}
                aria-label="Payment method"
              >
                <option value="SINPE">SINPE</option>
                <option value="SPEI">SPEI</option>
              </select>
            </label>
            <label>
              Reference
              <input
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                aria-label="Payment reference"
                required
              />
            </label>
            <button type="submit">Submit receipt</button>
          </form>
        )}

        {flow.step === 'tracking' && (
          <div data-testid="tracking-step" aria-live="polite">
            <p>Waiting for escrow release…</p>
            <ol aria-label="Escrow milestones">
              {flow.milestones.map((milestone) => (
                <li key={milestone.cursor}>{milestoneLabel(milestone.type)}</li>
              ))}
            </ol>
          </div>
        )}

        {flow.step === 'success' && (
          <output aria-live="polite" data-testid="checkout-success">
            Payment complete. Escrow {flow.escrow?.id} released.
          </output>
        )}

        {flow.step === 'disputed' && (
          <output aria-live="polite" data-testid="checkout-disputed">
            Escrow {flow.escrow?.id} has been disputed.
          </output>
        )}

        {showSimulatorControls(flow.testMode, flow.step, flow.escrow) && (
          <div
            className="pacto-checkout-simulator-controls"
            role="group"
            aria-label="Simulator controls"
            data-testid="checkout-simulator-controls"
          >
            <p>Simulator controls</p>
            <button type="button" onClick={() => flow.controls.forceRelease()}>
              Force release
            </button>
            <button type="button" onClick={() => flow.controls.forceDispute()}>
              Force dispute
            </button>
            <button type="button" onClick={() => flow.controls.forceTimeout()}>
              Force timeout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
