import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'Pacto-Signature';
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface VerifyOptions {
  toleranceSeconds?: number;
  nowSeconds?: number;
}

function buildSignedPayload(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

function computeSignature(signedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(signedPayload).digest('hex');
}

function signaturesMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function signPayload(body: string, secret: string, timestampSeconds?: number): string {
  const timestamp = timestampSeconds ?? Math.floor(Date.now() / 1000);
  const signedPayload = buildSignedPayload(timestamp, body);
  const signature = computeSignature(signedPayload, secret);
  return `t=${timestamp},v1=${signature}`;
}

export function parseSignatureHeader(
  header: string,
): { timestamp: number; signature: string } | null {
  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of header.split(',')) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key === 't') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      timestamp = parsed;
    } else if (key === 'v1') {
      signature = value;
    }
  }

  if (timestamp === undefined || signature === undefined) {
    return null;
  }

  return { timestamp, signature };
}

export function verifySignature(
  body: string,
  header: string,
  secret: string,
  options?: VerifyOptions,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) {
    return false;
  }

  const toleranceSeconds = options?.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (toleranceSeconds !== 0) {
    const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
      return false;
    }
  }

  const signedPayload = buildSignedPayload(parsed.timestamp, body);
  const expectedSignature = computeSignature(signedPayload, secret);

  return signaturesMatch(parsed.signature, expectedSignature);
}
