import { signPayload, WEBHOOK_SIGNATURE_HEADER } from './signature.js';

export interface PostResult {
  ok: boolean;
  status?: number;
  bodyText?: string;
  error?: string;
}

export interface PostOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10000;

export async function postSignedWebhook(
  url: string,
  body: string,
  secret: string,
  options?: PostOptions,
): Promise<PostResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signPayload(body, secret),
        'User-Agent': 'PactoConnect-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    });

    let bodyText: string | undefined;
    try {
      bodyText = await response.text();
    } catch {
      // best-effort read
    }

    return {
      ok: response.ok,
      status: response.status,
      bodyText,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'timeout' };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
