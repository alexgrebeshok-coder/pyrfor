# CEOClaw launch audit

Date: 2026-03-28
Branch: `feature/map-first-ui`
Scope: production web + release-center + release-ops freeze checkpoint

## Current release state

- Production web URL: `https://ceoclaw-dev.vercel.app`
- macOS artifact URL: `https://github.com/alexgrebeshok-coder/ceoclaw/releases/download/v1.0.0/CEOClaw_1.0.0_aarch64.dmg`
- iPhone channel: pending (`#iphone`)
- Release version: `1.0.0`
- Install-ready count: `2/3`

## What was verified

- `npm run release:check` passed locally.
- `npx tsc --noEmit` passed locally.
- `NEXT_PUBLIC_APP_URL='https://ceoclaw-dev.vercel.app' NEXTAUTH_URL='https://ceoclaw-dev.vercel.app' NEXT_PUBLIC_APP_VERSION='1.0.0' npm run release:status` reported:
  - web: external
  - desktop: github-release
  - iphone: pending
  - install-ready: `2/3`
  - next blocker: move the iPhone archive step onto a full Xcode machine
- Production deploy to Vercel succeeded on `ceoclaw-dev`.
- `BASE_URL='https://ceoclaw-dev.vercel.app' npm run smoke:postdeploy` passed.
- Remote Playwright release smoke passed against `https://ceoclaw-dev.vercel.app`.
- `GET https://ceoclaw-dev.vercel.app/api/health` returned `healthy` with version `1.0.0`.

## Blocking issues

### Hard blocker

- The iPhone/TestFlight path is still not finished because the current machine only has Command Line Tools and not full Xcode.

### Non-blocking warnings still present

- Vercel/production build still warns about `fs/promises` resolution from `lib/ai/agent-loader.ts`.
- Vercel/production build still warns about optional `js-tiktoken` resolution from `lib/ai/cost-tracker.ts`.
- Static generation still emits chart sizing warnings for some pages.
- `TELEGRAM_BOT_TOKEN` is not configured in the current production deployment, so the webhook warning still appears during build/runtime checks.

## Go / no-go

Recommendation: `NO-GO` for full launch.

Reason:
- web distribution is live and healthy;
- macOS distribution is live and install-ready;
- release hub is honest and points at real web/macOS channels;
- but the iPhone install path is still not publishable, so the canonical finish line is not met yet.

## Exact next move

1. Move to a machine with full Xcode selected.
2. Run `npm run check:xcode`.
3. Run the iPhone archive/build path and publish the TestFlight handoff URL.
4. Set `NEXT_PUBLIC_IOS_DOWNLOAD_URL` in production.
5. Re-run release preflight and post-deploy smoke, then flip the recommendation to `GO` only if install-ready becomes `3/3`.
