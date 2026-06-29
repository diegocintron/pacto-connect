import { useRouter } from 'next/router';
import type { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: (
    <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
      Pacto Connect
    </span>
  ),
  project: {
    link: 'https://github.com/pacto/pacto-connect',
  },
  docsRepositoryBase: 'https://github.com/pacto/pacto-connect/tree/main/apps/docs',
  footer: {
    text: '© 2024 Pacto. All rights reserved.',
  },
  useNextSeoProps() {
    const { asPath } = useRouter();
    if (asPath === '/') {
      return { titleTemplate: 'Pacto Connect Docs' };
    }
    return { titleTemplate: '%s – Pacto Connect' };
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="Embed P2P stablecoin buy/sell flows in minutes." />
    </>
  ),
  primaryHue: 220,
  navigation: true,
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
};

export default config;
