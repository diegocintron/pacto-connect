import type { Context, Next } from 'hono';
import { findActiveApiKeyByPublishableKey, isOriginAllowed, normalizeOrigin } from '../keys.js';

export const PUBLISHABLE_KEY_HEADER = 'x-pacto-publishable-key';

function extractPublishableKey(c: Context): string | null {
  const headerKey = c.req.header(PUBLISHABLE_KEY_HEADER);
  if (headerKey?.startsWith('pk_')) {
    return headerKey;
  }

  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer pk_')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return null;
}

function setCorsHeaders(c: Context, origin: string): void {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Vary', 'Origin');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  c.header(
    'Access-Control-Allow-Headers',
    `Content-Type, Authorization, ${PUBLISHABLE_KEY_HEADER}`,
  );
}

function originFromReferer(referer: string): string | null {
  // Referer includes the full URL (path/query/hash); normalizeOrigin rejects
  // that shape, so strip down to the origin component first.
  try {
    return normalizeOrigin(new URL(referer).origin);
  } catch {
    return null;
  }
}

function resolveRequestOrigin(c: Context): { origin: string | null; present: boolean } {
  const originHeader = c.req.header('Origin');
  if (originHeader !== undefined) {
    return { origin: normalizeOrigin(originHeader), present: true };
  }
  const referer = c.req.header('Referer');
  if (referer !== undefined) {
    return { origin: originFromReferer(referer), present: true };
  }
  return { origin: null, present: false };
}

export async function originValidation(c: Context, next: Next): Promise<Response | void> {
  const publishableKey = extractPublishableKey(c);
  if (!publishableKey) {
    return c.json({ error: 'publishable key required', code: 'key_required' }, 401);
  }

  const apiKey = await findActiveApiKeyByPublishableKey(publishableKey);
  if (!apiKey) {
    return c.json({ error: 'invalid or revoked publishable key', code: 'key_invalid' }, 403);
  }

  const { origin, present } = resolveRequestOrigin(c);
  if (!present) {
    return c.json({ error: 'origin or referer header required', code: 'origin_required' }, 403);
  }
  if (!origin) {
    return c.json({ error: 'malformed origin', code: 'invalid_origin' }, 403);
  }
  if (!isOriginAllowed(origin, apiKey.allowedOrigins)) {
    return c.json({ error: 'origin not allowed for this key', code: 'origin_not_allowed' }, 403);
  }

  setCorsHeaders(c, origin);

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  c.set('apiKey', apiKey);
  await next();
}
