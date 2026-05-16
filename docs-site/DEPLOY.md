# Deploying docs.pyrfor.dev

Public docs are built from an **allowlist** in [`allowlist.json`](./allowlist.json). Strategic internal plans (`PYRFOR-*-PLAN`, council notes, `OPERATIONS-ROADMAP`, `COPILOT-*`, `agent-discussions/`) are never synced.

## Local build

```bash
pnpm docs:sync
cd docs-site && pnpm install --ignore-workspace && pnpm build
# or from repo root:
pnpm docs:build
```

## Canonical URL

**Production canonical:** `https://docs.pyrfor.dev`

Choose **one** primary host and redirect the other with HTTP 301:

| Host | Role | DNS |
|------|------|-----|
| **GitHub Pages** (first wave) | `main` → [`.github/workflows/docs-deploy.yml`](../.github/workflows/docs-deploy.yml) | `CNAME` = `docs.pyrfor.dev` in [`static/CNAME`](./static/CNAME); enable Pages → GitHub Actions in repo Settings |
| **Vercel** (optional / preview) | Root Directory = `docs-site`; see [`vercel.json`](./vercel.json) | Add custom domain `docs.pyrfor.dev` in Vercel → point DNS CNAME to Vercel **or** keep Pages and use Vercel only for PR previews |

Recommended cutover when moving canonical DNS to Vercel:

1. Verify Vercel production build (`pnpm docs:build` locally first).
2. Add `docs.pyrfor.dev` in Vercel project → Domains.
3. Update DNS CNAME from GitHub Pages target to `cname.vercel-dns.com` (or Vercel-provided record).
4. Disable GitHub Pages custom domain **or** leave Pages on a staging subdomain to avoid duplicate content.

PR previews: connect the Vercel project to the GitHub repo; each PR gets a preview URL without touching production DNS.

## Secrets

No repository secrets are required for static docs deploy. GitHub Pages uses `GITHUB_TOKEN` via `deploy-pages`.
