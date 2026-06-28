/**
 * @pacto-connect/elements
 *
 * Custom element <pacto-checkout> + pacto.mount() for non-React sites.
 */

export const VERSION = '0.0.0';

export {
  applyCheckoutOptions,
  ELEMENT_TAG,
  type PactoBridgeMessage,
  PactoCheckoutElement,
  type PactoCheckoutOptions,
  registerPactoCheckoutElement,
} from './element.js';
export { createFocusTrap, type FocusTrap } from './focus-trap.js';
export { type FrameHandle, type FrameMountOptions, mountFrame } from './frame.js';
export {
  type BootstrapCheckoutFrameOptions,
  bootstrapCheckoutFrame,
  type FramePageHandle,
} from './frame-page.js';
export { type MountHandle, mount, resolveTarget } from './mount.js';
export { injectCheckoutStyles, STYLE_ELEMENT_ID } from './styles.js';
export { CheckoutView } from './ui.js';

import { registerPactoCheckoutElement } from './element.js';
import { mountFrame } from './frame.js';
import { bootstrapCheckoutFrame } from './frame-page.js';
import { mount } from './mount.js';

export const pacto = {
  mount,
  mountFrame,
  bootstrapCheckoutFrame,
  VERSION,
};

if (typeof window !== 'undefined') {
  registerPactoCheckoutElement();
  (window as Window & { pacto?: typeof pacto }).pacto = pacto;
}

declare global {
  interface Window {
    pacto: typeof pacto;
  }
}
