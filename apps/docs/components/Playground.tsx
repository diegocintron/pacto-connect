import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Playground.module.css';

interface PlaygroundConfig {
  publishableKey: string;
  mode: 'buy' | 'sell';
  listingId: string;
  gatewayUrl: string;
  testMode: boolean;
  injectStyles: boolean;
}

const DEFAULT_CONFIG: PlaygroundConfig = {
  publishableKey: 'pk_test_demo',
  mode: 'buy',
  listingId: '',
  gatewayUrl: '',
  testMode: true,
  injectStyles: true,
};

type SnippetLang = 'react' | 'vanilla' | 'cdn';

function generateReactSnippet(cfg: PlaygroundConfig): string {
  const lines: string[] = [
    `import { PactoCheckout } from '@pacto-connect/react'`,
    ``,
    `export default function App() {`,
    `  return (`,
  ];
  const props: string[] = [`    publishableKey="${cfg.publishableKey}"`, `    mode="${cfg.mode}"`];
  if (cfg.listingId) props.push(`    listingId="${cfg.listingId}"`);
  if (cfg.gatewayUrl) props.push(`    gatewayUrl="${cfg.gatewayUrl}"`);
  if (cfg.testMode) props.push(`    testMode`);
  props.push(`    onComplete={(escrow) => console.log('Checkout complete', escrow.id)}`);
  props.push(`    onClose={() => { /* hide the widget */ }}`);
  lines.push(`    <PactoCheckout`);
  lines.push(...props);
  lines.push(`    />`, `  )`, `}`);
  return lines.join('\n');
}

function generateVanillaSnippet(cfg: PlaygroundConfig): string {
  const opts: string[] = [`  publishableKey: '${cfg.publishableKey}'`, `  mode: '${cfg.mode}'`];
  if (cfg.listingId) opts.push(`  listingId: '${cfg.listingId}'`);
  if (cfg.gatewayUrl) opts.push(`  gatewayUrl: '${cfg.gatewayUrl}'`);
  if (cfg.testMode) opts.push(`  testMode: true`);
  opts.push(`  onComplete: (escrow) => {`);
  opts.push(`    console.log('Checkout complete', escrow.id)`);
  opts.push(`    handle.destroy()`);
  opts.push(`  },`);
  opts.push(`  onClose: () => handle.destroy(),`);

  return [
    `import { pacto } from '@pacto-connect/elements'`,
    ``,
    `// call when user clicks your "Buy" button`,
    `const handle = pacto.mount('#checkout-root', {`,
    ...opts,
    `})`,
  ].join('\n');
}

function generateCdnSnippet(cfg: PlaygroundConfig): string {
  const attrs: string[] = [`  publishable-key="${cfg.publishableKey}"`, `  mode="${cfg.mode}"`];
  if (cfg.listingId) attrs.push(`  listing-id="${cfg.listingId}"`);
  if (cfg.testMode) attrs.push(`  test-mode`);

  return [
    `<!-- 1. Load the CDN bundle -->`,
    `<script src="https://cdn.pacto.example/elements/latest/pacto.min.js"></script>`,
    ``,
    `<!-- 2a. Web component (auto-opens on mount) -->`,
    `<pacto-checkout`,
    ...attrs,
    `></pacto-checkout>`,
    ``,
    `<!-- 2b. Or programmatic mount -->`,
    `<div id="checkout-root"></div>`,
    `<script>`,
    `  const handle = window.pacto.mount('#checkout-root', {`,
    `    publishableKey: '${cfg.publishableKey}',`,
    `    mode: '${cfg.mode}',`,
    cfg.listingId ? `    listingId: '${cfg.listingId}',` : null,
    cfg.testMode ? `    testMode: true,` : null,
    `    onComplete: (escrow) => handle.destroy(),`,
    `    onClose: () => handle.destroy(),`,
    `  })`,
    `</script>`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

type MountHandle = {
  open(): void;
  close(): void;
  destroy(): void;
};

export function Playground(): ReactElement {
  const [cfg, setCfg] = useState<PlaygroundConfig>(DEFAULT_CONFIG);
  const [lang, setLang] = useState<SnippetLang>('react');
  const [copied, setCopied] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MountHandle | null>(null);

  const snippet =
    lang === 'react'
      ? generateReactSnippet(cfg)
      : lang === 'vanilla'
        ? generateVanillaSnippet(cfg)
        : generateCdnSnippet(cfg);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [snippet]);

  const openWidget = useCallback(async () => {
    if (!previewRef.current) return;
    setMountError(null);
    try {
      // Dynamic import keeps elements out of the SSR bundle
      const { pacto } = await import('@pacto-connect/elements');
      handleRef.current?.destroy();
      handleRef.current = pacto.mount(previewRef.current, {
        publishableKey: cfg.publishableKey,
        mode: cfg.mode,
        listingId: cfg.listingId || undefined,
        gatewayUrl: cfg.gatewayUrl || undefined,
        testMode: cfg.testMode,
        injectStyles: cfg.injectStyles,
        onComplete: () => {
          setWidgetOpen(false);
          handleRef.current = null;
        },
        onClose: () => {
          setWidgetOpen(false);
          handleRef.current = null;
        },
        onError: (err: Error) => {
          setMountError(err.message);
          setWidgetOpen(false);
        },
      });
      setWidgetOpen(true);
    } catch (err) {
      setMountError(err instanceof Error ? err.message : 'Failed to load widget');
    }
  }, [cfg]);

  const closeWidget = useCallback(() => {
    handleRef.current?.close();
    setWidgetOpen(false);
  }, []);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      handleRef.current?.destroy();
    };
  }, []);

  const update = <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: value }));
  };

  const isPkTest = cfg.publishableKey.startsWith('pk_test_');

  return (
    <div className={styles.root}>
      {/* ── Config panel ─────────────────────────────────────────── */}
      <aside className={styles.panel}>
        <h2 className={styles.panelTitle}>Configure</h2>

        <label className={styles.field}>
          <span className={styles.label}>Publishable key</span>
          <input
            className={styles.input}
            type="text"
            value={cfg.publishableKey}
            placeholder="pk_test_..."
            onChange={(e) => update('publishableKey', e.target.value)}
            spellCheck={false}
          />
          {cfg.publishableKey && !cfg.publishableKey.startsWith('pk_') && (
            <span className={styles.hint + ' ' + styles.warn}>
              Keys should start with <code>pk_live_</code> or <code>pk_test_</code>
            </span>
          )}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Mode</span>
          <select
            className={styles.select}
            value={cfg.mode}
            onChange={(e) => update('mode', e.target.value as 'buy' | 'sell')}
          >
            <option value="buy">buy</option>
            <option value="sell">sell</option>
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            Listing ID <span className={styles.optional}>(optional)</span>
          </span>
          <input
            className={styles.input}
            type="text"
            value={cfg.listingId}
            placeholder="lst_..."
            onChange={(e) => update('listingId', e.target.value)}
            spellCheck={false}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            Gateway URL <span className={styles.optional}>(optional)</span>
          </span>
          <input
            className={styles.input}
            type="text"
            value={cfg.gatewayUrl}
            placeholder="https://connect.pacto.example"
            onChange={(e) => update('gatewayUrl', e.target.value)}
            spellCheck={false}
          />
        </label>

        <div className={styles.toggleRow}>
          <span className={styles.label}>Test mode</span>
          <button
            role="switch"
            aria-checked={cfg.testMode}
            className={styles.toggle + (cfg.testMode ? ' ' + styles.toggleOn : '')}
            onClick={() => update('testMode', !cfg.testMode)}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>

        <div className={styles.toggleRow}>
          <span className={styles.label}>Inject default styles</span>
          <button
            role="switch"
            aria-checked={cfg.injectStyles}
            className={styles.toggle + (cfg.injectStyles ? ' ' + styles.toggleOn : '')}
            onClick={() => update('injectStyles', !cfg.injectStyles)}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>

        <div className={styles.previewActions}>
          {!widgetOpen ? (
            <button
              className={styles.btnPrimary}
              onClick={() => void openWidget()}
              disabled={!cfg.publishableKey}
            >
              Open widget
            </button>
          ) : (
            <button className={styles.btnSecondary} onClick={closeWidget}>
              Close widget
            </button>
          )}
          {!isPkTest && cfg.publishableKey && (
            <p className={styles.hint}>Using a live key — real funds may be involved.</p>
          )}
          {mountError && <p className={styles.error}>{mountError}</p>}
        </div>
      </aside>

      {/* ── Right column ─────────────────────────────────────────── */}
      <div className={styles.right}>
        {/* Live preview mount point */}
        <div className={styles.previewArea}>
          <div ref={previewRef} className={styles.previewMount} />
          {!widgetOpen && (
            <div className={styles.previewPlaceholder}>
              <div className={styles.previewIcon}>⬡</div>
              <p>
                Click <strong>Open widget</strong> to launch a live preview
              </p>
              <p className={styles.hint}>
                The widget mounts directly into this frame using <code>pacto.mount()</code>.
              </p>
            </div>
          )}
        </div>

        {/* Snippet panel */}
        <div className={styles.snippet}>
          <div className={styles.snippetTabs}>
            {(['react', 'vanilla', 'cdn'] as SnippetLang[]).map((l) => (
              <button
                key={l}
                className={styles.snippetTab + (lang === l ? ' ' + styles.snippetTabActive : '')}
                onClick={() => setLang(l)}
              >
                {l === 'react' ? 'React' : l === 'vanilla' ? 'Vanilla JS' : 'CDN / HTML'}
              </button>
            ))}
            <button className={styles.copyBtn} onClick={copy}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <pre className={styles.code}>
            <code>{snippet}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
