import type { ApiKey } from '@prisma/client';
import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { toGatewayErrorBody } from '../errors.js';
import { beginIdempotency, completeIdempotency, computeRequestHash } from '../idempotency.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export function idempotency() {
  return async (
    c: Context<{ Variables: { apiKey: ApiKey } }>,
    next: Next,
  ): Promise<Response | void> => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (!key) {
      return next();
    }

    const apiKey = c.get('apiKey');
    const rawBody = await c.req.text();
    const requestHash = computeRequestHash(c.req.method, c.req.path, rawBody);

    const begin = await beginIdempotency({ apiKeyId: apiKey.id, key, requestHash });

    if (begin.kind === 'replay') {
      c.header('Idempotent-Replayed', 'true');
      return c.body(begin.responseBody, begin.statusCode as ContentfulStatusCode, {
        'Content-Type': 'application/json',
      });
    }

    if (begin.kind === 'mismatch') {
      return c.json(
        toGatewayErrorBody(
          'idempotency_error',
          'idempotency_key_reuse',
          'Idempotency-Key was reused with a different request body',
        ),
        409,
      );
    }

    if (begin.kind === 'in_progress') {
      return c.json(
        toGatewayErrorBody(
          'idempotency_error',
          'request_in_progress',
          'A request with this Idempotency-Key is already in progress',
        ),
        409,
      );
    }

    await next();

    const responseBody = await c.res.clone().text();
    await completeIdempotency({
      apiKeyId: apiKey.id,
      key,
      statusCode: c.res.status,
      responseBody,
    });
  };
}
