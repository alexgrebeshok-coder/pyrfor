# CEOClaw Full Launch Roadmap

Updated: 2026-03-21

Canonical finish-line plan: `docs/ceoclaw-launch-master-plan.md`
This file is the detailed session prompt pack for multi-agent implementation work.
For the current compact handoff prompt, see `memory/codex-prompt-2026-03-20.md`.
For the current execution order and finish-the-product route, see `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md`.
For the post-launch product-improvement roadmap, see `plans/2026-03-20-market-gap-ux-roadmap.md`.
For the minimum stable product skeleton to lock before later expansion, see `plans/2026-03-20-skeleton-freeze-plan.md`.
For the concrete screen-by-screen route that executes the skeleton freeze, see `plans/2026-03-20-skeleton-freeze-execution-plan.md`.
For the final productization spine that ties goals, portfolio, finance, capacity, evidence, documents, and release packaging together, see `plans/2026-03-21-operational-truth-spine-plan.md`.
For the detailed phase-by-phase implementation route that a weaker model can execute step by step, see `plans/2026-03-21-operational-truth-spine-execution-plan.md`.
For the original AI-PMO / Severoavtodor source comparison, see `docs/ai-pmo-severoavtodor-origin-gap-analysis.md`.

This document answers two questions:

1. Is the multi-agent system finished?
2. What still needs to happen before CEOClaw is a real installable product on web, macOS, and iPhone?

## Short answer

The multi-agent core is real, useful, and already integrated into the product, but it is **not fully finished yet**.

What we have now is a strong scaffold:

- agent registry and role set;
- collaborative runtime and council-style execution;
- run storage and trace inspection;
- manifest-driven integration layer for custom AI providers and HTTP/JSON connectors;
- AI UI surfaces that expose the trace;
- desktop shell;
- iPhone shell;
- public release/download page.
- release preflight and release gate commands that validate the current distribution targets and smoke the release hub.
- the macOS release path is verified locally, while the iPhone build path now fails fast on machines that only have Command Line Tools.

What is still missing is the last mile that makes the system feel like one coherent product instead of several powerful parts.

## What "finished" means

We stop only when a new user can:

- open the public release page;
- download the macOS app on a MacBook or Mac mini and install it in a couple of clicks;
- install the iPhone app through TestFlight or the App Store path we choose;
- sign up or sign in without hidden manual setup;
- create projects, tasks, risks, calendar entries, Gantt items, briefs, and AI work items;
- see the same live data across web, desktop, and iPhone;
- recover after refresh, relaunch, or reconnect;
- attach new AI, GPS, and messenger systems through manifests or small adapters instead of rewriting the core app;
- find install steps, support, rollback, and release notes in one obvious place;
- trust the AI system because it shows the plan, the council, and the trace instead of hiding work.

If those things are not true, the product is not done yet.

## Current status

### Already real

- The app is already a live Next.js + Prisma product, not a toy prototype.
- The multi-agent runtime exists and is visible in the UI.
- The release page exists and is public.
- The desktop and iPhone shell paths exist.
- Build and test gates are already meaningful.

### Still incomplete

- The agent runtime is not yet the single canonical execution path everywhere.
- State is still split across multiple storage layers.
- Some release links still need to point at real signed artifacts.
- The desktop packaging flow is not yet a fully proven public distribution path.
- The iPhone flow is not yet a fully proven public distribution path.
- The integration layer still needs a final pass to make custom provider and connector onboarding fully operator-friendly.
- The final launch freeze, rollback, and release operations are not yet fully locked.

## Sequential finish plan

### Stage 1. Converge the multi-agent runtime

Goal: turn the current agent scaffold into one coherent runtime with typed plans, durable traces, and predictable handoffs.

Exit criteria:

- one canonical registry for agents, quick actions, and capabilities;
- one typed contract for plans, proposals, approvals, and trace records;
- clear failure behavior when AI is unavailable;
- the same runtime model used by the AI surfaces instead of ad hoc routing.

### Stage 2. Make agent state durable and replayable

Goal: ensure runs, memory, and traces survive refreshes, restarts, and releases.

Exit criteria:

- run history can be loaded and inspected later;
- trace data is durable;
- memory layers are separated by purpose;
- the system can explain what happened in a run.

### Stage 3. Wire the runtime into the product

Goal: make the AI system useful inside the actual product workflows.

Exit criteria:

- users can see why the AI suggested something;
- approvals are visible and guarded;
- work-report and AI result views reflect the same runtime truth;
- the UI shows the council, not just the final answer.

### Stage 4. Finish the macOS delivery path

Goal: make macOS a normal downloadable product.

Exit criteria:

- a signed or distributable artifact exists;
- a clean Mac can install and open it;
- hotkeys, tray/menu, and window restore work;
- the release page links to the real artifact;
- the build steps are repeatable and documented.

### Stage 5. Finish the iPhone delivery path

Goal: make iPhone a normal installable product path.

Exit criteria:

- the archive/sync/build flow is reproducible;
- a simulator or device smoke passes;
- auth/session and safe-area behavior feel normal on phone widths;
- TestFlight or App Store distribution is ready or clearly documented.

### Stage 6. Finalize the release center and operations

Goal: give users and operators one obvious place to install, support, and recover the product.

Exit criteria:

- the public release page links to the real build artifacts;
- versioned notes and support links are present;
- rollback and incident response are documented;
- the team can operate the app without tribal knowledge.

### Stage 7. Freeze and launch

Goal: publish the actual product and stop moving the finish line.

Exit criteria:

- public release is tagged and published;
- web, desktop, and iPhone all point to the same live product core;
- smoke tests, build, and e2e checks are green;
- monitoring and support are ready.

## Recommended session order

1. Multi-agent runtime convergence
2. Durable state and replay
3. Product wiring and approval gates
4. macOS packaging and release artifacts
5. iPhone packaging and archive flow
6. Release center, docs, and ops freeze
7. Final launch audit

## Session prompts

### Session 1 - Multi-agent runtime convergence

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: make the multi-agent system one coherent runtime instead of several parallel AI code paths.

Own these files:
- lib/ai/multi-agent-runtime.ts
- lib/ai/agents.ts
- lib/ai/types.ts
- lib/ai/server-runs.ts
- lib/ai/trace.ts
- lib/ai/provider-adapter.ts
- app/api/ai/**
- components/ai/**

Tasks:
- create one canonical agent registry and quick-action contract;
- make the runtime plan typed instead of free-text where possible;
- ensure every live AI run records the selected agent(s), plan, support roles, approvals, and final outcome;
- keep production fail-closed when no live AI provider is configured;
- remove duplicated routing logic if it conflicts with the runtime contract.

Validation:
- add or update targeted tests for the runtime contract;
- npm run test:run
- npm run build

Return:
- files changed
- what is now canonical
- what remains intentionally deferred
```

### Session 2 - Durable state and replay

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: make AI runs, memory, and traces durable, inspectable, and replayable.

Own these files:
- lib/memory/**
- lib/ai/server-runs.ts
- lib/ai/trace.ts
- prisma/schema.prisma
- any small helper or repository layer files needed for the storage model

Tasks:
- separate thread memory, project memory, and org knowledge;
- make run history durable across restarts;
- keep trace data queryable for later inspection;
- add replay or rehydrate behavior where it helps operator trust;
- avoid hidden local-only state in the critical server path.

Validation:
- prisma generate
- targeted unit tests
- npm run test:run
- npm run build

Return:
- storage model changes
- what is now durable
- what replay/inspection now works
```

### Session 3 - Product wiring and approvals

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: make the AI runtime visible and useful in the actual product flows.

Own these files:
- components/ai/**
- components/work-reports/**
- app/briefs/page.tsx
- app/work-reports/page.tsx
- app/api/work-reports/**
- any small UI files needed for approval or trace rendering

Tasks:
- ensure users can see the council/trace before they apply risky actions;
- keep approval gates obvious for mutations;
- make the result views and work-report surfaces reflect the same runtime truth;
- remove any remaining user-facing illusion that the AI did work it did not actually do.

Validation:
- focused component tests
- npm run test:run
- npm run build

Return:
- files changed
- what user-facing AI flow is now honest
- what remains behind a gate
```

### Session 4 - macOS packaging and release artifact

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: turn the existing Tauri shell into a repeatable macOS distribution path.

Own these files:
- src-tauri/**
- scripts/build-desktop-shell.mjs
- docs/desktop-setup.md
- package.json
- the minimum release-page wiring needed for real download links

Tasks:
- keep the desktop shell thin and branded;
- make the build artifact path repeatable;
- document signing and notarization steps clearly;
- make the release page point to a real signed artifact when the URL is configured;
- verify clean-machine install assumptions as much as the environment allows.

Validation:
- cargo check
- npm run build
- desktop packaging smoke or the closest available equivalent

Return:
- files changed
- exact macOS build command
- what still blocks public distribution
```

### Session 5 - iPhone packaging and archive flow

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: turn the existing Capacitor shell into a reproducible iPhone distribution path.

Own these files:
- capacitor.config.ts
- scripts/build-mobile-shell.mjs
- ios/**
- docs/mobile-app.md
- package.json
- the minimum release-page wiring needed for iPhone install links

Tasks:
- keep the iPhone shell thin and live-web based;
- make archive/sync/build steps reproducible;
- document TestFlight and App Store readiness clearly;
- keep the release page honest about whether the link is a beta build, a TestFlight link, or a public store link.

Validation:
- npm run mobile:ios:sync
- npm run mobile:ios:build
- a simulator/device smoke where possible

Return:
- files changed
- exact iPhone build command
- what still blocks TestFlight/App Store readiness
```

### Session 6 - Release center, docs, and ops freeze

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: make the public release page and runbooks match the actual install artifacts and operational reality.

Own these files:
- app/release/**
- components/release/**
- docs/release-ready-plan.md
- RUNBOOK.md
- README.md
- DEPLOY.md

Tasks:
- point the release page at real build artifacts and version notes;
- make support, rollback, and install paths obvious;
- remove any aspirational wording that is not yet true;
- keep the manifest onboarding story aligned between `/integrations`, `README.md`, and `docs/integration-platform.md`;
- freeze the launch checklist so operators can run it without tribal knowledge.

Validation:
- npm run build
- npm run test:run
- any smoke test that proves the release page and public-path behavior still work

Return:
- files changed
- what the public release surface now says
- what still blocks launch
```

### Session 7 - Final launch audit

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: do the last pass and produce a yes/no launch recommendation.

Own these files:
- docs/release-ready-plan.md
- RUNBOOK.md
- README.md
- DEPLOY.md
- any small checklist or release-notes files needed for the final audit

Tasks:
- verify the web app, desktop app, iPhone path, AI runtime, and ops docs against the actual codebase;
- call out the last blockers honestly;
- produce a go/no-go release recommendation;
- do not claim launch-ready if any install path still needs manual engineering help.

Validation:
- npm run build
- npm run test:run
- the best available smoke coverage for the current machine

Return:
- final audit summary
- go/no-go recommendation
- remaining blockers, if any
```

## Final acceptance checklist

The product is complete only when all of these are true:

- the public release page exists and points to real artifacts;
- the hosted web app works for sign-up, sign-in, onboarding, CRUD, AI, and reporting;
- the macOS app can be downloaded and installed on a clean MacBook or Mac mini;
- the iPhone app can be installed through the chosen release channel;
- the same live data appears across web, desktop, and iPhone;
- the AI system shows trace, council, and approval flow instead of hiding work;
- monitoring, rollback, and support are documented;
- build, test, and smoke checks are green.

If any of those are not true, we still have work to do.
