import { runDueDeliveries } from './delivery.js';

export const DEFAULT_POLL_INTERVAL_MS = 5000;

export function getPollIntervalMs(): number {
  const configured = process.env.WEBHOOK_POLL_INTERVAL_MS;
  if (!configured) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return parsed;
}

export interface DeliveryRunner {
  stop: () => void;
}

export function startDeliveryRunner(options?: { intervalMs?: number }): DeliveryRunner {
  const intervalMs = options?.intervalMs ?? getPollIntervalMs();
  let running = false;

  const timer = setInterval(async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      await runDueDeliveries();
    } catch (error) {
      console.error('webhook runner:', error);
    } finally {
      running = false;
    }
  }, intervalMs);

  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
