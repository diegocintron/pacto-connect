import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAME_SANDBOX } from './frame.js';

// Use Node's URL explicitly (aliased): the jsdom test environment shims the
// global/bare `URL` binding to resolve relative URLs against its own
// document location (http://localhost:3000) instead of this file's file://
// base, which breaks fileURLToPath. The aliased import avoids the shim.
const bundlePath = fileURLToPath(new NodeURL('../dist/index.js', import.meta.url));
const docPath = fileURLToPath(
  new NodeURL('../../../apps/docs/pages/security.mdx', import.meta.url),
);

describe('widget CSP compatibility', () => {
  it('has a built bundle to inspect (run `npm run build` first)', () => {
    expect(existsSync(bundlePath), `missing bundle at ${bundlePath} — run the elements build`).toBe(
      true,
    );
  });

  it('bundle contains no eval() or new Function() (would require unsafe-eval)', () => {
    const src = readFileSync(bundlePath, 'utf8');
    expect(/\beval\s*\(/.test(src)).toBe(false);
    expect(/new\s+Function\s*\(/.test(src)).toBe(false);
  });

  it('bundle injects no inline <script> (would require unsafe-inline)', () => {
    const src = readFileSync(bundlePath, 'utf8');
    expect(/<script/i.test(src)).toBe(false);
  });

  it('documented sandbox string matches FRAME_SANDBOX', () => {
    const doc = readFileSync(docPath, 'utf8');
    expect(doc.includes(FRAME_SANDBOX)).toBe(true);
  });
});
