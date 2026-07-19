import { CheckoutFlowController, resolveMessages } from '@pacto-connect/core';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutView } from './ui';

function controllerInStep() {
  // Minimal fake controller stuck on the deposit step with an escrow.
  const escrow = { id: 'esc_1', amount: '100', asset: 'USDC' };
  return {
    getState: () => ({
      step: 'deposit',
      testMode: false,
      escrow,
      listings: [],
      milestones: [],
      error: null,
      sessionId: 'sess_1',
    }),
  } as unknown as CheckoutFlowController;
}

describe('CheckoutView theming and i18n', () => {
  it('renders Spanish copy when given the es dictionary', () => {
    const container = document.createElement('div');
    const view = new CheckoutView(container, controllerInStep(), {
      onClose: vi.fn(),
      messages: resolveMessages('es'),
    });
    view.render();
    expect(container.querySelector('h2')?.textContent).toBe('Depositar en garantía');
    expect(container.textContent).toContain('Deposita 100 USDC al contrato de garantía.');
    view.destroy();
  });

  it('applies theme CSS variables to the overlay container', () => {
    const container = document.createElement('div');
    const view = new CheckoutView(container, controllerInStep(), {
      onClose: vi.fn(),
      messages: resolveMessages('en'),
      theme: { colors: { primary: '#e11d48' } },
    });
    view.render();
    expect(container.style.getPropertyValue('--pacto-color-primary')).toBe('#e11d48');
    view.destroy();
  });

  it('renders the brand logo in the header when logoUrl is set', () => {
    const container = document.createElement('div');
    const view = new CheckoutView(container, controllerInStep(), {
      onClose: vi.fn(),
      messages: resolveMessages('en'),
      logoUrl: 'https://cdn.example/logo.svg',
      logoAlt: 'Acme',
    });
    view.render();
    const logo = container.querySelector('img.pacto-checkout-logo') as HTMLImageElement | null;
    expect(logo).not.toBeNull();
    expect(logo?.src).toBe('https://cdn.example/logo.svg');
    expect(logo?.alt).toBe('Acme');
    view.destroy();
  });
});
