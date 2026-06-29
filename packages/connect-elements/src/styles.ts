/**
 * Default modal styling for the checkout overlay.
 *
 * The React widget expects the host app to provide CSS, but a plain-HTML embed
 * has no bundler step to import a stylesheet. We inject a single `<style>` tag
 * (once per document) so the overlay renders as a centred modal out of the box.
 * Hosts can override any rule via the same `pacto-checkout-*` class names, and
 * can opt out entirely by passing `injectStyles: false`.
 */

export const STYLE_ELEMENT_ID = 'pacto-checkout-styles';

const CHECKOUT_STYLES = `
.pacto-checkout-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.55);
  z-index: 2147483647;
}

.pacto-checkout-dialog {
  width: 100%;
  max-width: 24rem;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  padding: 1.5rem;
  border-radius: 0.75rem;
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

.pacto-checkout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.pacto-checkout-header h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.pacto-checkout-dialog button {
  cursor: pointer;
  border-radius: 0.5rem;
  border: 1px solid transparent;
  background: #4f46e5;
  color: #ffffff;
  padding: 0.5rem 0.875rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.pacto-checkout-header button {
  background: transparent;
  color: #475569;
  border-color: #e2e8f0;
  padding: 0.25rem 0.625rem;
}

.pacto-checkout-dialog ul,
.pacto-checkout-dialog ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.pacto-checkout-dialog form {
  display: grid;
  gap: 0.75rem;
}

.pacto-checkout-dialog label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.875rem;
}

.pacto-checkout-dialog input,
.pacto-checkout-dialog select {
  width: 100%;
  padding: 0.5rem 0.625rem;
  border-radius: 0.5rem;
  border: 1px solid #cbd5e1;
  font-size: 0.875rem;
}

.pacto-checkout-dialog [data-testid="checkout-error"] {
  color: #b91c1c;
}

.pacto-checkout-test-banner {
  margin: -1.5rem -1.5rem 1rem;
  padding: 0.625rem 1rem;
  border-radius: 0.75rem 0.75rem 0 0;
  background: #fef3c7;
  color: #92400e;
  border-bottom: 1px solid #fcd34d;
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: center;
  letter-spacing: 0.02em;
}

.pacto-checkout-simulator-controls {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px dashed #cbd5e1;
  display: grid;
  gap: 0.5rem;
}

.pacto-checkout-simulator-controls p {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pacto-checkout-simulator-controls button {
  background: #f59e0b;
  border-color: #d97706;
}

.pacto-checkout-simulator-controls button:hover {
  background: #d97706;
}
`;

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
  style.textContent = CHECKOUT_STYLES;
  doc.head.append(style);
  return style;
}
