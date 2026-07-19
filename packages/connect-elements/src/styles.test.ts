import { DEFAULT_THEME } from '@pacto-connect/core';
import { afterEach, describe, expect, it } from 'vitest';
import { injectCheckoutStyles, STYLE_ELEMENT_ID } from './styles';

describe('injectCheckoutStyles', () => {
  afterEach(() => {
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
  });

  it('injects a single style element into the document head', () => {
    const style = injectCheckoutStyles();
    expect(style).toBeInstanceOf(HTMLStyleElement);
    expect(document.head.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
    expect(style?.textContent).toContain('.pacto-checkout-overlay');
  });

  it('uses the tokenized stylesheet from core (var fallbacks)', () => {
    const style = injectCheckoutStyles();
    expect(style?.textContent).toContain(
      `var(--pacto-color-primary, ${DEFAULT_THEME.colors.primary})`,
    );
  });

  it('is idempotent and reuses the existing style element', () => {
    const first = injectCheckoutStyles();
    const second = injectCheckoutStyles();
    expect(second).toBe(first);
    expect(document.head.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
  });
});
