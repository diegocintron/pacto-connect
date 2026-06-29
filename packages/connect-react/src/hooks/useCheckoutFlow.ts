import {
  CheckoutFlowController,
  type CheckoutFlowState,
  type CheckoutStep,
  type Escrow,
  type Listing,
} from '@pacto-connect/core';
import { useEffect, useRef, useState } from 'react';

export type { CheckoutStep };

export interface UseCheckoutFlowOptions {
  publishableKey: string;
  gatewayUrl?: string;
  listingId?: string;
  mode?: 'buy' | 'sell';
  testMode?: boolean;
  enabled: boolean;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
}

export interface UseCheckoutFlowControls {
  forceRelease: () => Promise<void>;
  forceDispute: (reason?: string) => Promise<void>;
  forceTimeout: () => Promise<void>;
}

export interface UseCheckoutFlowResult {
  step: CheckoutStep;
  listings: Listing[];
  selectedListing: Listing | null;
  escrow: Escrow | null;
  quote: import('@pacto-connect/core').Quote | null;
  error: Error | null;
  milestones: import('@pacto-connect/core').EscrowEvent[];
  testMode: boolean;
  controls: UseCheckoutFlowControls;
  selectListing: (listing: Listing) => Promise<void>;
  confirmDeposit: () => Promise<void>;
  submitReceipt: (method: 'SINPE' | 'SPEI', reference: string, receipt?: string) => Promise<void>;
  retry: () => void;
}

const INITIAL_STATE: CheckoutFlowState = {
  step: 'loading',
  sessionId: null,
  listings: [],
  selectedListing: null,
  escrow: null,
  quote: null,
  error: null,
  milestones: [],
  testMode: false,
};

export function useCheckoutFlow(options: UseCheckoutFlowOptions): UseCheckoutFlowResult {
  const [state, setState] = useState<CheckoutFlowState>(INITIAL_STATE);
  const controllerRef = useRef<CheckoutFlowController | null>(null);

  const onCompleteRef = useRef(options.onComplete);
  const onDisputeRef = useRef(options.onDispute);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onCompleteRef.current = options.onComplete;
    onDisputeRef.current = options.onDispute;
    onErrorRef.current = options.onError;
  });

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    const controller = new CheckoutFlowController({
      publishableKey: options.publishableKey,
      gatewayUrl: options.gatewayUrl,
      listingId: options.listingId,
      mode: options.mode,
      testMode: options.testMode,
      onChange: setState,
      onComplete: (escrow) => onCompleteRef.current?.(escrow),
      onDispute: (escrow) => onDisputeRef.current?.(escrow),
      onError: (error) => onErrorRef.current?.(error),
    });

    controllerRef.current = controller;
    void controller.start();

    return () => {
      controller.destroy();
      controllerRef.current = null;
      setState(INITIAL_STATE);
    };
  }, [
    options.enabled,
    options.gatewayUrl,
    options.listingId,
    options.mode,
    options.publishableKey,
    options.testMode,
  ]);

  return {
    ...state,
    controls: {
      forceRelease: () => controllerRef.current?.forceTestRelease() ?? Promise.resolve(),
      forceDispute: (reason) =>
        controllerRef.current?.forceTestDispute(reason) ?? Promise.resolve(),
      forceTimeout: () => controllerRef.current?.forceTestTimeout() ?? Promise.resolve(),
    },
    selectListing: (listing) => controllerRef.current?.selectListing(listing) ?? Promise.resolve(),
    confirmDeposit: () => controllerRef.current?.confirmDeposit() ?? Promise.resolve(),
    submitReceipt: (method, reference, receipt) =>
      controllerRef.current?.submitReceipt(method, reference, receipt) ?? Promise.resolve(),
    retry: () => controllerRef.current?.retry(),
  };
}
