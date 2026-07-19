import {
  type CheckoutFlowController,
  type CheckoutStep,
  type DeepPartial,
  type EscrowEvent,
  type FiatPaymentMethod,
  formatMessage,
  type PactoMessages,
  type PactoTheme,
  themeToCssVars,
} from '@pacto-connect/core';
import { createFocusTrap, type FocusTrap } from './focus-trap.js';

const SIMULATOR_STEPS: CheckoutStep[] = ['deposit', 'uploadReceipt', 'tracking'];

function showSimulatorControls(
  testMode: boolean,
  step: CheckoutStep,
  escrow: import('@pacto-connect/core').Escrow | null,
): boolean {
  return testMode && escrow !== null && SIMULATOR_STEPS.includes(step);
}

export interface CheckoutViewOptions {
  onClose: () => void;
  messages: PactoMessages;
  theme?: DeepPartial<PactoTheme>;
  logoUrl?: string;
  logoAlt?: string;
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
    const m = this.options.messages;
    this.container.replaceChildren();
    this.container.className = 'pacto-checkout-overlay';
    this.container.dataset.testid = 'pacto-checkout-overlay';

    for (const [name, value] of Object.entries(themeToCssVars(this.options.theme))) {
      this.container.style.setProperty(name, value);
    }

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

    const heading = document.createElement('div');
    heading.className = 'pacto-checkout-heading';

    if (this.options.logoUrl) {
      const logo = document.createElement('img');
      logo.className = 'pacto-checkout-logo';
      logo.src = this.options.logoUrl;
      logo.alt = this.options.logoAlt ?? '';
      heading.append(logo);
    }

    const title = document.createElement('h2');
    title.id = titleId;
    title.textContent = m.steps[state.step];
    heading.append(title);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', m.actions.closeAria);
    closeButton.textContent = m.actions.close;
    closeButton.addEventListener('click', () => this.options.onClose());

    header.append(heading, closeButton);
    dialog.append(header);

    if (state.testMode) {
      dialog.prepend(this.createTestBanner(m));
    }

    switch (state.step) {
      case 'loading':
        dialog.append(this.createLoading(m));
        break;
      case 'error':
        dialog.append(this.createError(state.error, m));
        break;
      case 'selectListing':
        dialog.append(this.createListingList(state.listings, m));
        break;
      case 'deposit':
        if (state.escrow) {
          dialog.append(this.createDeposit(state.escrow, m));
        }
        break;
      case 'uploadReceipt':
        dialog.append(this.createReceiptForm(m));
        break;
      case 'tracking':
        dialog.append(this.createTracking(state.milestones, m));
        break;
      case 'success':
        dialog.append(this.createSuccess(state.escrow, m));
        break;
      case 'disputed':
        dialog.append(this.createDisputed(state.escrow, m));
        break;
    }

    if (showSimulatorControls(state.testMode, state.step, state.escrow)) {
      dialog.append(this.createSimulatorControls(m));
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

  private createTestBanner(m: PactoMessages): HTMLElement {
    const banner = document.createElement('div');
    banner.className = 'pacto-checkout-test-banner';
    banner.role = 'status';
    banner.dataset.testid = 'checkout-test-banner';
    banner.textContent = m.labels.testBanner;
    return banner;
  }

  private createSimulatorControls(m: PactoMessages): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'pacto-checkout-simulator-controls';
    wrapper.role = 'group';
    wrapper.setAttribute('aria-label', m.labels.simulatorControls);
    wrapper.dataset.testid = 'checkout-simulator-controls';

    const label = document.createElement('p');
    label.textContent = m.labels.simulatorControls;

    const releaseButton = document.createElement('button');
    releaseButton.type = 'button';
    releaseButton.textContent = m.actions.forceRelease;
    releaseButton.addEventListener('click', () => {
      void this.controller.forceTestRelease();
    });

    const disputeButton = document.createElement('button');
    disputeButton.type = 'button';
    disputeButton.textContent = m.actions.forceDispute;
    disputeButton.addEventListener('click', () => {
      void this.controller.forceTestDispute();
    });

    const timeoutButton = document.createElement('button');
    timeoutButton.type = 'button';
    timeoutButton.textContent = m.actions.forceTimeout;
    timeoutButton.addEventListener('click', () => {
      void this.controller.forceTestTimeout();
    });

    wrapper.append(label, releaseButton, disputeButton, timeoutButton);
    return wrapper;
  }

  private createLoading(m: PactoMessages): HTMLElement {
    const output = document.createElement('output');
    output.setAttribute('aria-live', 'polite');
    output.dataset.testid = 'checkout-loading';
    output.textContent = m.labels.loading;
    return output;
  }

  private createError(error: Error | null, m: PactoMessages): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.role = 'alert';
    wrapper.dataset.testid = 'checkout-error';

    const message = document.createElement('p');
    message.textContent = error?.message ?? m.labels.genericError;

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = m.actions.retry;
    retryButton.addEventListener('click', () => this.controller.retry());

    wrapper.append(message, retryButton);
    return wrapper;
  }

  private createListingList(
    listings: import('@pacto-connect/core').Listing[],
    m: PactoMessages,
  ): HTMLElement {
    const list = document.createElement('ul');
    list.role = 'listbox';
    list.setAttribute('aria-label', m.labels.availableListings);
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

  private createDeposit(
    escrow: import('@pacto-connect/core').Escrow,
    m: PactoMessages,
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.dataset.testid = 'deposit-step';

    const text = document.createElement('p');
    text.textContent = formatMessage(m.labels.depositInstruction, {
      amount: escrow.amount,
      asset: escrow.asset,
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = m.actions.confirmDeposit;
    button.addEventListener('click', () => {
      void this.controller.confirmDeposit();
    });

    wrapper.append(text, button);
    return wrapper;
  }

  private createReceiptForm(m: PactoMessages): HTMLElement {
    const form = document.createElement('form');
    form.dataset.testid = 'receipt-form';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.controller.submitReceipt(this.method, this.reference);
    });

    const methodLabel = document.createElement('label');
    methodLabel.textContent = m.labels.paymentMethod;
    const methodSelect = document.createElement('select');
    methodSelect.setAttribute('aria-label', m.labels.paymentMethod);
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
    referenceLabel.textContent = m.labels.reference;
    const referenceInput = document.createElement('input');
    referenceInput.type = 'text';
    referenceInput.required = true;
    referenceInput.setAttribute('aria-label', m.labels.referenceAria);
    referenceInput.value = this.reference;
    referenceInput.addEventListener('input', () => {
      this.reference = referenceInput.value;
    });
    referenceLabel.append(referenceInput);

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = m.actions.submitReceipt;

    form.append(methodLabel, referenceLabel, submitButton);
    return form;
  }

  private createTracking(milestones: EscrowEvent[], m: PactoMessages): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.dataset.testid = 'tracking-step';
    wrapper.setAttribute('aria-live', 'polite');

    const text = document.createElement('p');
    text.textContent = m.labels.waiting;

    const list = document.createElement('ol');
    list.setAttribute('aria-label', m.labels.escrowMilestones);
    for (const milestone of milestones) {
      const item = document.createElement('li');
      item.textContent = m.milestones[milestone.type];
      list.append(item);
    }

    wrapper.append(text, list);
    return wrapper;
  }

  private createSuccess(
    escrow: import('@pacto-connect/core').Escrow | null,
    m: PactoMessages,
  ): HTMLElement {
    const output = document.createElement('output');
    output.setAttribute('aria-live', 'polite');
    output.dataset.testid = 'checkout-success';
    output.textContent = formatMessage(m.labels.success, { escrowId: escrow?.id ?? '' });
    return output;
  }

  private createDisputed(
    escrow: import('@pacto-connect/core').Escrow | null,
    m: PactoMessages,
  ): HTMLElement {
    const output = document.createElement('output');
    output.setAttribute('aria-live', 'polite');
    output.dataset.testid = 'checkout-disputed';
    output.textContent = formatMessage(m.labels.disputed, { escrowId: escrow?.id ?? '' });
    return output;
  }
}
