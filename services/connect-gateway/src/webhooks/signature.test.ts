import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  parseSignatureHeader,
  signPayload,
  verifySignature,
} from './signature.js';

describe('webhook signature', () => {
  const body = '{"event":"test"}';
  const secret = 'whsec_test_secret';
  const timestamp = 1_700_000_000;

  it('signPayload produces a header parseable by parseSignatureHeader with matching timestamp', () => {
    const header = signPayload(body, secret, timestamp);
    const parsed = parseSignatureHeader(header);

    expect(parsed).toEqual({ timestamp, signature: expect.any(String) });
    expect(parsed!.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifySignature returns true for a freshly signed payload', () => {
    const header = signPayload(body, secret, timestamp);

    expect(verifySignature(body, header, secret, { nowSeconds: timestamp })).toBe(true);
  });

  it('returns false when the body is tampered', () => {
    const header = signPayload(body, secret, timestamp);

    expect(verifySignature('{"event":"tampered"}', header, secret, { nowSeconds: timestamp })).toBe(
      false,
    );
  });

  it('returns false when verified with a different secret', () => {
    const header = signPayload(body, secret, timestamp);

    expect(verifySignature(body, header, 'whsec_other_secret', { nowSeconds: timestamp })).toBe(
      false,
    );
  });

  it('returns false when the timestamp is outside tolerance', () => {
    const header = signPayload(body, secret, timestamp);

    expect(
      verifySignature(body, header, secret, {
        nowSeconds: timestamp + 600,
      }),
    ).toBe(false);
    expect(DEFAULT_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });

  it('returns true when outside the default window but toleranceSeconds: 0 disables the check', () => {
    const header = signPayload(body, secret, timestamp);

    expect(
      verifySignature(body, header, secret, {
        nowSeconds: timestamp + 600,
        toleranceSeconds: 0,
      }),
    ).toBe(true);
  });

  it('returns false for a malformed header', () => {
    expect(verifySignature(body, 'not-a-sig', secret, { nowSeconds: timestamp })).toBe(false);
  });
});

describe('webhook signature with nonce', () => {
  const body = '{"event":"test"}';
  const secret = 'whsec_test_secret';
  const timestamp = 1_700_000_000;
  const nonce = 'nonce_abc123';

  it('signs and verifies a payload carrying a nonce', () => {
    const header = signPayload(body, secret, timestamp, nonce);
    expect(header).toContain(`n=${nonce}`);

    const parsed = parseSignatureHeader(header);
    expect(parsed?.nonce).toBe(nonce);
    expect(verifySignature(body, header, secret, { nowSeconds: timestamp })).toBe(true);
  });

  it('fails verification when the nonce in the header is tampered', () => {
    const header = signPayload(body, secret, timestamp, nonce);
    const tampered = header.replace(`n=${nonce}`, 'n=nonce_evil');
    expect(verifySignature(body, tampered, secret, { nowSeconds: timestamp })).toBe(false);
  });
});
