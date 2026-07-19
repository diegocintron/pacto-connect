/**
 * Default modal styling for the checkout overlay.
 *
 * The React widget expects the host app to provide CSS, but a plain-HTML embed
 * has no bundler step to import a stylesheet. We inject a single `<style>` tag
 * (once per document) so the overlay renders as a centred modal out of the box.
 * The CSS itself — tokenized with `--pacto-*` variables — lives in
 * `@pacto-connect/core` so the React and web-component builds stay identical.
 * Hosts can override any rule via the same `pacto-checkout-*` class names or
 * the `--pacto-*` variables, and can opt out entirely with `injectStyles: false`.
 */

import { buildCheckoutStylesheet, STYLE_ELEMENT_ID } from '@pacto-connect/core';

export { STYLE_ELEMENT_ID };

/**
 * Injects the default checkout stylesheet into `document.head` once. Returns
 * the `<style>` element (existing or newly created), or `null` when there is no
 * DOM (e.g. during SSR).
 */
export function injectCheckoutStyles(doc: Document = document): HTMLStyleElement | null {
  if (typeof doc === 'undefined' || !doc.head) {
    return null;
  }

  const existing = doc.getElementById(STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = buildCheckoutStylesheet();
  doc.head.append(style);
  return style;
}
