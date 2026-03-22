# CEOClaw Final Mile Execution Plan

**Date:** 2026-03-20  
**Status:** Active  
**Supersedes:** none

This is the current step-by-step route from "strong product" to "installable product that can be published and operated without tribal knowledge".

Canonical finish line:
- `docs/release-ready-plan.md`

Canonical launch doctrine:
- `docs/ceoclaw-launch-master-plan.md`

Current compact handoff:
- `memory/codex-prompt-2026-03-20.md`

## 1. Current state snapshot

Already real:
- live web app with Prisma-backed data;
- multi-agent runtime integrated into the product;
- replayable and comparable AI run traces;
- public `/release` hub with honesty badges and smoke coverage;
- desktop shell, iPhone shell, and desktop-local MLX bridge;
- release commands for status, check, desktop, mobile, and smoke;
- macOS release path verified locally and producing a DMG artifact.

Still blocking the finish line:
- iPhone packaging still requires a machine with full Xcode, not Command Line Tools;
- public artifact URLs still need to be wired where they are available;
- the release hub must stay honest and point at real artifacts, not placeholders;
- final launch freeze and operator rollback posture still need to be tightened once the artifacts are public.

Separate future track:
- iPhone on-device AI is intentionally out of scope for the launch path and lives in `plans/2026-03-20-iphone-on-device-ai-future-track.md`.

## 2. What "done" means

CEOClaw is done only when a new user can:
- open the hosted web app;
- download the macOS app on a MacBook or Mac mini, install it, and log in;
- install the iPhone app through TestFlight or App Store and start working immediately;
- create and edit projects, tasks, risks, calendar items, Gantt items, and AI work items;
- see the same live data across web, desktop, and iPhone;
- recover after refresh, relaunch, reconnect, or update without losing trust;
- find install steps, support, rollback, and release notes in one obvious place.

## 3. Hard dependencies

We cannot finish the iPhone release path without:
- a macOS machine with full Xcode installed;
- signing and archive credentials for the chosen iPhone distribution path;
- a confirmed TestFlight or App Store workflow if we want public distribution.

We cannot finish the release center without:
- real macOS and iPhone URLs or release assets;
- a decision about whether the desktop artifact is published as a file link, object-store link, or release asset;
- a final versioned note for the release surface.

## 4. Execution order

### Step 1. Make the macOS artifact public

Goal: turn the local DMG into a user-facing download channel.

Work:
- choose the publication target for the DMG or ZIP;
- upload or publish the artifact;
- use `npm run release:publish:desktop` as the repeatable publisher when the GitHub release path is the chosen target;
- set `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL`;
- keep the `/release` page pointing at the real artifact;
- verify the release preflight reports desktop as a live target.

Exit criteria:
- `npm run release:status` shows a live desktop URL;
- `npm run release:publish:desktop` creates or updates the GitHub release asset;
- `/release` shows the desktop card as download ready;
- a clean Mac can download, install, and open the app.

Session prompt:
```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: publish the signed macOS artifact and make the release hub point at the real download.

Own these files:
- components/release/release-page.tsx
- lib/release.ts
- scripts/release-preflight.mjs
- README.md
- docs/release-ready-plan.md
- docs/ceoclaw-launch-master-plan.md

Tasks:
- pick the artifact publication target;
- wire the desktop download URL;
- keep the release page honest about the desktop channel;
- verify the desktop release path stays smoke-testable.

Validation:
- npm run release:status
- npm run release:desktop
- npm run release:smoke

Return:
- files changed
- artifact URL
- open blockers
```

### Step 2. Finish the iPhone path on full Xcode

Goal: make the iPhone build and archive path real, repeatable, and distribution-ready.

Work:
- move to a machine with full Xcode installed;
- run the Xcode guard and confirm the environment is valid;
- sync the Capacitor project, archive the app, and verify it opens;
- confirm signing, bundle id, and device/simulator behavior;
- set `NEXT_PUBLIC_IOS_DOWNLOAD_URL` when the chosen distribution path exists.

Exit criteria:
- the iPhone archive/build path works on a machine with full Xcode;
- the iPhone channel is described honestly on `/release`;
- TestFlight or App Store distribution is ready or explicitly documented.

Session prompt:
```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: finish the iPhone packaging path on a machine with full Xcode.

Own these files:
- scripts/check-xcode.mjs
- scripts/build-mobile-shell.mjs
- package.json
- docs/mobile-app.md
- components/release/release-page.tsx
- scripts/release-preflight.mjs

Tasks:
- verify Xcode is installed and selected correctly;
- build or archive the iPhone shell;
- confirm the app opens and reaches the live web product;
- wire the iPhone release target into the release hub when a real URL exists.

Validation:
- npm run check:xcode
- npm run mobile:ios:sync
- npm run mobile:ios:build
- npm run release:mobile

Return:
- files changed
- archive/build status
- remaining iPhone blockers
```

### Step 3. Keep the release hub honest

Goal: make `/release` the one obvious place to install the product.

Work:
- keep live/fallback badges honest;
- point buttons to real URLs as soon as they exist;
- keep version notes, support notes, and rollback hints visible;
- make sure the release page still works as a support entry point.

Exit criteria:
- no dead install buttons;
- status cards match actual availability;
- the page explains what a user gets before they click.

### Step 4. Polish only the flows that affect installability or trust

Goal: improve only the surfaces that block adoption or cause confusion.

Work:
- close the remaining data reflection gaps across projects, tasks, calendar, Gantt, risks, analytics, and AI;
- keep AI trace and approval flow visible where users need it;
- refine empty/loading/error states on release-critical surfaces;
- leave lint debt for after release blockers are gone unless a warning affects correctness.

Exit criteria:
- a new user can work without asking where their data went;
- the product feels obvious on web, desktop, and phone;
- there is no hidden demo path in normal production usage.

### Step 5. Final launch audit and freeze

Goal: make the final go/no-go decision and stop moving the finish line.

Work:
- run `npm run build`;
- run `npm run test:run`;
- run `npm run release:check`;
- run desktop install smoke on a clean machine if possible;
- run iPhone smoke on the Xcode-backed path;
- review warnings that still matter to release trust;
- publish or tag the release when the surfaces are ready.

Exit criteria:
- build, tests, and release smoke are green;
- the release page points at real install paths;
- we have a clear yes/no launch recommendation;
- any remaining blockers are named plainly.

## 5. What we are not doing

- No React Native rewrite for v1.
- No separate backend for desktop or iPhone.
- No offline-first native client as a launch requirement.
- No hidden manual setup steps for users.
- No demo/mock fallback in normal user-facing production paths.

## 6. Recommended session sequence

1. Publish macOS artifact.
2. Finish iPhone packaging on full Xcode.
3. Lock the release hub to real URLs.
4. Do the minimum product polish needed for trust and installability.
5. Run the final audit and freeze.
