import nextra from 'nextra';

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
  staticImage: true,
});

export default withNextra({
  reactStrictMode: true,
  transpilePackages: ['@pacto-connect/core', '@pacto-connect/react', '@pacto-connect/elements'],
});
