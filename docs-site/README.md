# docs.pyrfor.dev

Public [Docusaurus](https://docusaurus.io/) site for Pyrfor. Content is synced from the monorepo `docs/` tree via an allowlist — not every file under `docs/` is published.

## Commands

From the repository root:

```bash
pnpm docs:sync      # copy allowlisted docs + regenerate sidebars.ts
pnpm docs:build     # sync, install docs-site deps, production build
```

From this directory:

```bash
pnpm install
pnpm start          # dev server
pnpm build          # run pnpm docs:sync from root first if sources changed
```

## Deploy

See [DEPLOY.md](./DEPLOY.md) for GitHub Pages (primary CI) and Vercel (optional canonical DNS / PR previews).

Live site: **https://docs.pyrfor.dev**
