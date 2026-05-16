import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Pyrfor',
  tagline: 'Governed local-first AI coding workspace',
  favicon: 'img/favicon.ico',
  url: 'https://docs.pyrfor.dev',
  baseUrl: '/',
  organizationName: 'alexgrebeshok-coder',
  projectName: 'pyrfor',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  markdown: {
    format: 'md',
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/alexgrebeshok-coder/pyrfor/tree/main/docs-site/',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'Pyrfor',
      items: [
        { href: 'https://github.com/alexgrebeshok-coder/pyrfor', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} Pyrfor contributors — Apache-2.0`,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
