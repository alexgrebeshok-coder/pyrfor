# CEOClaw: plan for an out-of-the-box release

This is the canonical finish-line plan for CEOClaw.
If a task does not move us toward the outcomes described here, it is not launch-critical.

The more detailed sequencing lives in `docs/ceoclaw-launch-master-plan.md`.
The session-level prompt pack lives in `docs/full-launch-roadmap.md`.
The current step-by-step execution route lives in `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md`.
The post-launch product-improvement roadmap lives in `plans/2026-03-20-market-gap-ux-roadmap.md`.
The skeleton-freeze plan that locks the minimum stable product spine lives in `plans/2026-03-20-skeleton-freeze-plan.md`.
The concrete screen-by-screen route for that skeleton lives in `plans/2026-03-20-skeleton-freeze-execution-plan.md`.
The UX and Russian-first language execution companion lives in `plans/2026-03-20-ux-language-quality-plan.md`.

## 1. What "done" means

CEOClaw is considered finished only when a new user can:

- open the hosted web app;
- download the macOS desktop app and install it in a couple of clicks;
- install the iPhone app and start using it immediately;
- sign in without manual setup beyond account creation;
- create and edit projects, tasks, risks, calendar items, Gantt items, and AI work items;
- read a live portfolio cockpit with goals, budget, forecast scenarios, capacity pressure, and an OKR filter path from management theme to the related projects in plain language;
- open a dedicated documents hub for app docs, normative references, and project files with Finder-like search;
- see a quick map-and-logistics summary on the dashboard and jump into the field hub when needed;
- see the same data reflected across web, desktop, and iPhone surfaces;
- recover from refresh, relaunch, and reconnect without losing state;
- find install, support, rollback, and release notes in one obvious place.

That means the product is not "done" when the code merely builds.
It is done when the install and first-use journey is boringly reliable.

## 2. Release surfaces

| Surface | How users get it | What it must do | Release gate |
| --- | --- | --- | --- |
| Hosted web app | Public HTTPS domain | Full product access, auth, onboarding, data CRUD, AI, dashboards | Production deploy + smoke tests |
| macOS desktop app | Signed DMG or ZIP from a release page | Native-feeling shell around the live app, hotkeys, window restore, clean startup | Clean-machine install + launch smoke |
| iPhone app | TestFlight for beta, App Store for public launch | Touch-safe shell around the live app, safe areas, install flow, stable auth/session | Device/simulator smoke + archive-ready build on full Xcode |
| Release page | Public landing/download page | Clear install buttons and versioned notes | Works without asking the user to ask support |
| Ops surface | Runbooks and monitoring | Rollback, deploy, support, incident response | Someone can operate the product without tribal knowledge |

## 3. Product architecture we are committing to

- One source of truth for product data: the hosted Next.js + Prisma backend.
- Thin desktop and iPhone shells that wrap the live product, not separate re-writes.
- PWA remains a fallback convenience layer, not the launch definition.
- No production demo/mock fallback in user-facing flows.
- Any native-only capability must improve installability or usability, not create a second product.
- Manifest-driven integration layer for AI providers, GPS APIs, and messenger APIs so new systems can be attached without changing the core product contract.
- The `/integrations` page exposes the operator-facing manifest onboarding card so the setup story matches the runtime layer.
- AI run traces are replayable from persisted input, so operators can reopen a run and compare a fresh council result against the stored history.

## 4. Non-goals

- No React Native rewrite for v1.
- No separate backend for desktop or iPhone.
- No offline-first native client as a launch requirement.
- No on-device AI on iPhone for the launch release; that is a separate future track.
- No Windows or Android launch scope unless we explicitly add it later.
- No hidden manual setup steps for end users.

## 5. Execution phases

### Phase 0. Lock the product contract

Goal: freeze the live-first contract so the release surfaces do not drift apart.

Work items:

- keep auth, tenant, and data scoping honest across the API;
- remove or quarantine mock/demo fallbacks from production paths;
- keep server snapshots and client state in sync for projects, tasks, calendar, Gantt, risks, analytics, and search;
- keep server snapshots and client state in sync for projects, tasks, documents, calendar, Gantt, risks, analytics, and search;
- make sure fresh installs and reconnects do not require developer intervention.

Exit criteria:

- `npm run build` is green;
- `npm run test:run` is green;
- the main user flows work without demo-only code paths;
- the app still behaves correctly after refresh and relaunch.

### Phase 1. Finish the hosted web app

Goal: make the public web app a product, not just a dev environment.

Work items:

- host the app on a stable public HTTPS domain;
- verify onboarding, login, signup, and session recovery end to end;
- ensure core surfaces work from the public site:
  - dashboard;
  - projects;
  - tasks;
  - risks;
  - calendar;
  - Gantt;
  - analytics;
  - AI chat cockpit;
- make empty/loading/error states look intentional;
- keep mobile and desktop layouts consistent with the live data model.

Exit criteria:

- a new user can create an account, sign in, and use the app without asking for manual setup;
- public deploys are reproducible;
- smoke tests cover the critical paths.

### Phase 2. Finish the macOS desktop app

Goal: turn the Tauri shell into a normal downloadable desktop product.

Work items:

- keep the shell thin and branded;
- point it at the live production app;
- make window state, hotkeys, native menu, and tray behavior reliable;
- make install/update metadata consistent;
- produce a signed and notarized release artifact;
- publish the signed DMG through a repeatable release command and keep the release notes versioned;
- publish the desktop package on a download page or release channel.

Exit criteria:

- a clean Mac can download the artifact, install it, open it, and log in;
- the app starts in a branded loading state and then loads the live product;
- desktop-specific behavior works:
  - window restore;
  - hotkeys;
  - menu actions;
  - tray or app menu where applicable;
- the packaging flow is documented and repeatable.

### Phase 3. Finish the iPhone app

Goal: make the iPhone build feel like a real installable product.

Work items:

- keep the iPhone shell thin and connected to the live web app;
- preserve safe areas, touch targets, and mobile navigation;
- verify auth/session persistence on iPhone;
- make the install flow obvious;
- prepare the Xcode archive path and release metadata;
- require a full Xcode installation on the packaging machine and fail fast on Command Line Tools-only setups;
- use TestFlight as the gating step before a public App Store launch.

Exit criteria:

- the app can be installed on a real iPhone or simulator build path;
- the app opens, logs in, and can be used immediately;
- the product behaves well at phone widths;
- the archive/build path is documented and reproducible on a machine with full Xcode.

### Phase 4. Build the release and download surface

Goal: give users one obvious place to get the right installer.

Work items:

- create or polish a public download page;
- expose clear buttons for:
  - web app;
  - macOS download;
  - iPhone download or App Store/TestFlight;
- show version, release notes, and known issues;
- make the page work as the support entry point for first-time users.

Exit criteria:

- a user can find the right install path without asking support;
- every downloadable artifact has a version and short release note;
- the release page links match the actual build artifacts.

### Phase 5. QA, observability, and rollback

Goal: make release operations safe enough to repeat.

Work items:

- keep unit, integration, and Playwright smoke tests in CI;
- keep a Playwright smoke on `/release` so the public install hub stays obvious and reachable;
- expose a single release preflight command so operators can see the current web, desktop, and iPhone distribution targets;
- include the current next blocker, install-ready count, and Xcode/archive posture in that preflight output;
- keep one full release gate command (`npm run release:check`) that combines build, tests, and release smoke;
- add packaging smoke where relevant:
  - desktop build smoke;
  - iPhone archive/sync smoke;
- keep Sentry and runtime health checks wired;
- document rollback and incident steps;
- keep a short release checklist that someone else can run.

Exit criteria:

- if a release breaks, we can detect it quickly;
- we know how to roll back or disable the release path;
- the release preflight command explains whether each channel is live or still a fallback;
- the team does not depend on tribal knowledge to operate the app.

### Phase 6. Public launch

Goal: publish the actual product that users can install and use.

Work items:

- tag and publish the release;
- publish the desktop artifact;
- publish the iPhone build to TestFlight or App Store, depending on launch stage;
- update the public release page and changelog;
- verify that the web app, desktop app, and iPhone app all point at the same live product.

Exit criteria:

- users can download, install, and work immediately on at least the supported public channels;
- the release is discoverable from the public site;
- support and rollback paths are ready.

## 6. Final acceptance checklist

The product is launch-complete only when all of these are true:

- Web:
  - public HTTPS deployment exists;
  - signup/login/onboarding work;
  - projects, tasks, risks, calendar, Gantt, analytics, and AI work on live data;
  - no demo/mock fallback is visible to normal users.
- macOS:
  - signed/notarized artifact exists;
  - install and first launch work on a clean machine;
  - window restore and hotkeys work;
  - a download page or release page exists.
- iPhone:
  - archive-ready build exists;
  - install path works through TestFlight or App Store;
  - safe areas, touch targets, and mobile nav are polished;
  - auth/session persistence works.
- Operations:
- build/test/e2e smoke is green;
- the `/release` page smoke passes and points users to the right install paths;
- monitoring is active;
- rollback path is documented;
- release notes exist.

## 7. How we should think about "finished"

We are not finishing when the codebase looks elegant.
We are finishing when the product is boring to install, obvious to open, and reliable to use.

The end state is:

- one live product core;
- one public web surface;
- one downloadable desktop package;
- one installable iPhone package;
- one public release page;
- one operator runbook;
- one monitoring story.

Anything beyond that is iteration, not launch-critical work.

## 8. Pointers for implementation

- Canonical finish-line and phase sequencing: `docs/ceoclaw-launch-master-plan.md`
- Multi-agent session prompt pack: `docs/full-launch-roadmap.md`
- Origin gap analysis: `docs/ai-pmo-severoavtodor-origin-gap-analysis.md`
- Integration platform: `docs/integration-platform.md`
- Final productization spine: `plans/2026-03-21-operational-truth-spine-plan.md`
- Final phase-by-phase execution route: `plans/2026-03-21-operational-truth-spine-execution-plan.md`
- Web/runtime details: `README.md`, `DEPLOY.md`, `RUNBOOK.md`
- Desktop details: `docs/desktop-setup.md`
- iPhone on-device AI future track: [plans/2026-03-20-iphone-on-device-ai-future-track.md](plans/2026-03-20-iphone-on-device-ai-future-track.md)
- iPhone details: `docs/mobile-app.md`
- Release planning and execution notes: `docs/multi-agent-launch-prompts.md`
