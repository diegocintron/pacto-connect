import type {
  CheckoutFlowController,
  CheckoutStep,
  EscrowEvent,
  FiatPaymentMethod,
} from '@pacto-connect/core';
import { createFocusTrap, type FocusTrap } from './focus-trap.js';

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

export interface CheckoutViewOptions {
  onClose: () => void;
}

export class CheckoutView {
  private method: FiatPaymentMethod = 'SINPE';
  private reference = '';
  private focusTrap: FocusTrap | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly controller: CheckoutFlowController,
    private readonly options: CheckoutViewOptions,
  ) {}

  render(): void {
    const state = this.controller.getState();
    this.container.replaceChildren();
    this.container.className = 'pacto-checkout-overlay';
    this.container.dataset.testid = 'pacto-checkout-overlay';

    const dialog = document.createElement('div');
    dialog.role = 'dialog';
    dialog.ariaModal = 'true';
    dialog.className = 'pacto-checkout-dialog';
    dialog.dataset.testid = 'pacto-checkout-dialog';
    dialog.tabIndex = -1;

    const titleId = 'pacto-checkout-title';
    dialog.setAttribute('aria-labelledby', titleId);

    const header = document.createElement('header');
    header.className = 'pacto-checkout-header';

    const title = document.createElement('h2');
    title.id = titleId;
    title.textContent = stepLabel(state.step);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close checkout');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => this.options.onClose());

    header.append(title, closeButton);
    dialog.append(header);

    if (state.testMode) {
      dialog.prepend(this.createTestBanner());
    }

    switch (state.step) {
      case 'loading':
        dialog.append(this.createLoading());
        break;
      case 'error':
        dialog.append(this.createError(state.error));
        break;
      case 'selectListing':
        dialog.append(this.createListingList(state.listings));
        break;
      case 'deposit':
        if (state.escrow) {
          dialog.append(this.createDeposit(state.escrow));
        }
        break;
      case 'uploadReceipt':
        dialog.append(this.createReceiptForm());
        break;
      case 'tracking':
        dialog.append(this.createTracking(state.milestones));
        break;
      case 'success':
        dialog.append(this.createSuccess(state.escrow));
        break;
      case 'disputed':
        dialog.append(this.createDisputed(state.escrow));
        break;
    }

    if (showSimulatorControls(state.testMode, state.step, state.escrow)) {
      dialog.append(this.createSimulatorControls());
    }

    this.container.append(dialog);

    // Trap focus on the persistent overlay container (the inner dialog node is
    // swapped on every re-render). Activate on first render; afterwards pull
    // focus back inside if a re-render dropped it.
    if (this.focusTrap) {
      this.focusTrap.refocus();
    } else {
      this.focusTrap = createFocusTrap(this.container, () => this.options.onClose());
    }
  }

  destroy(): void {
    this.focusTrap?.release();
    this.focusTrap = null;
  }

  private createTestBanner(): HTMLElement {
    const banner = document.createElement('div');
    banner.className = 'pacto-checkout-test-banner';
    banner.role = 'status';
    banner.dataset.testid = 'checkout-test-banner';
    banner.textContent = 'TEST MODE — no real funds or Stellar transactions';
    return banner;
  }

  private createSimulatorControls(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'pacto-checkout-simulator-controls';
    wrapper.role = 'group';
    wrapper.setAttribute('aria-label', 'Simulator controls');
    wrapper.dataset.testid = 'checkout-simulator-controls';

    const label = document.createElement('p');
    label.textContent = 'Simulator controls';

    const releaseButton = document.createElement('button');
    releaseButton.type = 'button';
    releaseButton.textContent = 'Force release';
    releaseButton.addEventListener('click', () => {
      void this.controller.forceTestRelease();
    });

    const disputeButton = document.createElement('button');
    disputeButton.type = 'button';
    disputeButton.textContent = 'Force dispute';
    disputeButton.addEventListener('click', () => {
      void this.controller.forceTestDispute();
    });

    const timeoutButton = document.createElement('button');
    timeoutButton.type = 'button';
    timeoutButton.textContent = 'Force timeout';
    timeoutButton.addEventListener('click', () => {
      void this.controller.forceTestTimeout();
    });

    wrapper.append(label, releaseButton, disputeButton, timeoutButton);
    return wrapper;
  }

  private createLoading(): HTMLElement {
    const output = document.createElement('output');
    output.setAttribute('aria-live', 'polite');
    output.dataset.testid = 'checkout-loading';
    output.textContent = 'Loading…';
    return output;
  }

  private createError(error: Error | null): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.role = 'alert';
    wrapper.dataset.testid = 'checkout-error';

    const message = document.createElement('p');
    message.textContent = error?.message ?? 'Something went wrong';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Retry';
    retryButton.addEventListener('click', () => this.controller.retry());

    wrapper.append(message, retryButton);
    return wrapper;
  }

  private createListingList(listings: import('@pacto-connect/core').Listing[]): HTMLElement {
    const list = document.createElement('ul');
    list.role = 'listbox';
    list.setAttribute('aria-label', 'Available listings');
    list.dataset.testid = 'listing-list';

    for (const listing of listings) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${listing.asset} — ${listing.amount} @ ${listing.price}`;
      button.addEventListener('click', () => {
        void this.controller.selectListing(listing);
      });
      item.append(button);
      list.append(item);
    }

    return list;
  }

  private createDeposit(escrow: import('@pacto-connect/core').Escrow): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.dataset.testid = 'deposit-step';

    const text = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = escrow.amount;
    text.append('Deposit ', strong, ` ${escrow.asset} to the escrow contract.`);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Confirm deposit';
    button.addEventListener('click', () => {
      void this.controller.confirmDeposit();
    });

    wrapper.append(text, button);
    return wrapper;
  }

  private createReceiptForm(): HTMLElement {
    const form = document.createElement('form');
    form.dataset.testid = 'receipt-form';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.controller.submitReceipt(this.method, this.reference);
    });

    const methodLabel = document.createElement('label');
    methodLabel.textContent = 'Payment method';
    const methodSelect = document.createElement('select');
    methodSelect.setAttribute('aria-label', 'Payment method');
    for (const value of ['SINPE', 'SPEI'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      methodSelect.append(option);
    }
    methodSelect.value = this.method;
    methodSelect.addEventListener('change', () => {
      this.method = methodSelect.value as FiatPaymentMethod;
    });
    methodLabel.append(methodSelect);

    const referenceLabel = document.createElement('label');
    referenceLabel.textContent = 'Reference';
    const referenceInput = document.createElement('input');
    referenceInput.type = 'text';
    referenceInput.required = true;
    referenceInput.setAttribute('aria-label', 'Payment reference');
    referenceInput.value = this.reference;
    referenceInput.addEventListener('input', () => {
      this.reference = referenceInput.value;
    });
    referenceLabel.append(referenceInput);

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Submit receipt';

    form.append(methodLabel, referenceLabel, submitButton);
    return form;
  }

  private createTracking(milestones: EscrowEvent[]): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.dataset.testid = 'tracking-step';
    wrapper.setAttribute('aria-live', 'polite');

    const text = document.createElement('p');
    text.textContent = 'Waiting for escrow release…';

    const list = document.createElement('ol');
    list.setAttribute('aria-label', 'Escrow milestones');
    for (const milestone of milestones) {
      const item = document.createElement('li');
      item.textContent = milestoneLabel(milestone.type);
      list.append(item);
    }

    wrapper.append(text, list);
    return wrapper;
  }

  private createSuccess(escrow: import('@pacto-connect/core').Escrow | null): HTMLElement {
    const output = document.createElement('output');
    output.setAttribute('aria-live', 'polite');
    output.dataset.testid = 'checkout-success';
    output.textContent = `Payment complete. Escrow ${escrow?.id ?? ''} released.`;
    return output;
  }

  private createDisputed(escrow: import('@pacto-connect/core').Escrow | null): HTMLElement {
    const output = document.createElement('output');
    output.setAttribute('aria-live', 'polite');
    output.dataset.testid = 'checkout-disputed';
    output.textContent = `Escrow ${escrow?.id ?? ''} has been disputed.`;
    return output;
  }
}
