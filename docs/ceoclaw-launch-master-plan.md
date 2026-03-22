# CEOClaw Launch Master Plan

Updated: 2026-03-21

This is the canonical plan for finishing CEOClaw as a product that people can download, install, open, and use immediately on the web, macOS, and iPhone.

## 1. Finish line

CEOClaw is done only when a new user can:

- open the hosted web app over HTTPS;
- create an account and sign in without manual developer setup;
- create and update projects, tasks, risks, milestones, calendar items, Gantt items, and AI work items;
- see the same live data on web, macOS, and iPhone;
- download and install the macOS app on a clean MacBook or Mac mini;
- install the iPhone app through the chosen public path;
- inspect AI council traces, approvals, and outcomes;
- find install steps, release notes, rollback notes, and support contacts in one obvious place;
- recover after refresh, relaunch, reconnect, or update without losing trust.

If any of those fail, the product is not launch-complete yet.

## 2. Current state

Already real:

- live web product with Prisma-backed data;
- AI council runtime integrated into the AI workspace;
- `/api/ai/chat` now bridges legacy chat UX to the council runtime;
- trace inspector exists for AI runs;
- manifest-driven integration layer exists for custom AI providers and HTTP/JSON connectors;
- `/integrations` now includes an operator-facing manifest onboarding card for the new provider/connector layer;
- the portfolio cockpit now includes live forecast, capacity, and scenario compare blocks, so the business view shows budget trajectory and utilization without leaving the portfolio surface;
- the goals screen now shows a priority card and key result cards that tie objectives to budget and capacity pressure, plus an objective filter strip that jumps from a management theme to the related projects, so the user immediately sees which management contour needs attention first, what the target level is, and where it lives in the portfolio;
- Tauri desktop shell exists;
- desktop-local MLX bridge exists and auto-starts the fine-tuned model on Mac;
- Capacitor iPhone shell exists;
- public release page exists;
- build and test gates are green;
- the skeleton-freeze roadmap now defines the minimum stable product spine for the next phase.

Still not fully finished:

  - durable AI run replay and trace comparison are available in the inspector, with only minor polish left in the surrounding UX;
- fully visible approval flow across all AI entry points;
- repeatable signed desktop distribution;
- repeatable iPhone archive/TestFlight/App Store path, with a full Xcode install on the packaging machine;
- public release surface linked to real artifacts;
- launch freeze and rollback docs are not yet the final operator truth.

## 3. What we are committing to

- One product core: the hosted Next.js + Prisma backend is the source of truth.
- Thin shells only: desktop and iPhone wrap the live app instead of becoming separate products.
- Fail closed in production: if live AI is unavailable, the app should say so clearly.
- No hidden demo path in normal user-facing production flows.
- No on-device AI on iPhone for launch; keep that as a separate future track.
- Same data across surfaces: if a user creates something, it must appear everywhere it should.
- Manifest-driven integration layer: custom AI providers and HTTP/JSON connectors can be added without rewriting the core app.
- Every release-critical change must be reflected in the README and plan docs.

## 4. Execution phases

### Phase 1. Canonical runtime convergence

Goal: make the multi-agent system one coherent runtime, not parallel AI paths.

Deliverables:

- canonical agent registry and quick-action contract;
- one typed run contract for plan, proposals, trace, and approval state;
- `/api/ai/chat` using the council runtime as a compatibility bridge;
- consistent fail-closed behavior when live AI is unavailable.

Exit criteria:

- the chat cockpit, workspace AI, and trace views all point to the same runtime truth;
- the selected agent, run id, and status can be observed in the UI;
- no production path silently falls back to mock behavior.

### Phase 2. Durable state and replay

Goal: make AI runs, traces, and memory durable enough to inspect later.

Deliverables:

- durable run history;
- durable trace data;
- separate thread, project, and org-level memory;
- replay or rehydrate support where it improves operator trust.

Exit criteria:

- a run can be reopened after refresh or restart;
- the system can explain what happened in a run;
- critical state is not trapped in local-only storage.

### Phase 3. Product wiring and approvals

Goal: surface the council and approval gates inside the actual work surfaces.

Deliverables:

- visible council/trace in AI result views and work reports;
- clear approval gates for proposals and mutations;
- honest empty/loading/error states in AI surfaces;
- shared semantics between chat, work reports, and action pilots.

Exit criteria:

- users can see why the AI suggested something;
- users can tell when human approval is still required;
- AI work is explainable, not magical.

### Phase 4. Web product polish

Goal: make the hosted web app feel finished and dependable.

Deliverables:

- complete data reflection across projects, tasks, calendar, Gantt, risks, and analytics;
- consistent responsive layout and mobile behavior;
- polished empty, loading, and error states;
- stable onboarding and auth journeys.

Exit criteria:

- a new user can sign in and work immediately;
- refresh/reconnect does not break the visible state;
- the public web app is the best version of the product.

### Phase 5. macOS packaging and release

Goal: turn the Tauri shell into a normal downloadable desktop product.

Deliverables:

- repeatable desktop build flow;
- signed/notarized release artifact or a documented equivalent;
- window restore, hotkeys, and tray/menu polish;
- release page links that point to the real artifact.

Exit criteria:

- a clean Mac can download, install, open, and use the app;
- the release page explains exactly what the Mac user is getting;
- the packaging process is repeatable.

### Phase 6. iPhone packaging and release

Goal: make iPhone a real installable delivery path.

Deliverables:

- repeatable Capacitor sync/build/archive flow;
- a fail-fast guard for Command Line Tools-only machines so operators know they need full Xcode;
- safe-area, touch-target, and mobile-navigation polish;
- a clearly documented TestFlight or App Store path;
- release page links that honestly describe the iPhone channel.

Exit criteria:

- an iPhone or simulator can install and open the app successfully;
- auth/session behavior is stable on phone widths;
- the release page does not overpromise about the channel.

### Phase 7. Release center and operations freeze

Goal: make install, support, rollback, and version notes obvious.

Deliverables:

- a public release/download page;
- versioned release notes;
- a release preflight command that shows whether web, macOS, and iPhone targets are live or fallback;
- a single release gate command (`npm run release:check`) that runs build, tests, and release smoke;
- a Playwright smoke that verifies `/release` stays reachable and shows the install paths;
- support and rollback docs;
- operator runbook aligned with the real codebase.

Exit criteria:

- a user can find the right install path without asking support;
- operators can run the product without tribal knowledge;
- public docs match the actual release artifacts.
- the public release hub still points to the right install path for web, macOS, and iPhone.

### Phase 8. Final launch audit

Goal: make the final go/no-go call.

Deliverables:

- final smoke across web, desktop, and iPhone paths;
- review of remaining warnings and technical debt;
- explicit launch recommendation;
- documented remaining blockers if any.

Exit criteria:

- build, tests, and smoke are green;
- there is a clear yes/no release recommendation;
- the product is either launch-ready or the blockers are named plainly.

## 5. Session order

Recommended order:

1. Runtime convergence
2. Durable state and replay
3. Product wiring and approvals
4. Web polish and data reflection
5. macOS packaging and release
6. iPhone packaging and release
7. Release center and operations freeze
8. Final launch audit

## 6. Prompt pack

Use the detailed session prompts in:

- `docs/full-launch-roadmap.md`
- `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md`
- `plans/2026-03-20-market-gap-ux-roadmap.md`
- `plans/2026-03-21-operational-truth-spine-plan.md`
- `plans/2026-03-21-operational-truth-spine-execution-plan.md`
- [plans/2026-03-20-iphone-on-device-ai-future-track.md](plans/2026-03-20-iphone-on-device-ai-future-track.md)
- `docs/ai-pmo-severoavtodor-origin-gap-analysis.md`
- `memory/codex-prompt-2026-03-20.md`

The first file is the prompt pack for implementation sessions. The second file is the source comparison against the original AI-PMO / Severoavtodor documentation set. This master plan is the canonical finish-line and sequencing doc.

## 7. Operating rules

- Update the README whenever a launch-critical behavior changes.
- Update the relevant plan doc whenever a stage is completed or re-scoped.
- Prefer thin shells over rewrites.
- Prefer honest failure modes over hidden fallback logic.
- Keep tests tied to the user-visible contract, not just implementation details.

## 8. Final acceptance checklist

The product is complete only when all of these are true:

- hosted web app is public and reliable;
- macOS package can be downloaded and installed on a clean machine;
- iPhone path is reproducible and installable;
- AI council trace is visible and trustworthy;
- same live data is reflected across surfaces;
- monitoring, rollback, and support are documented;
- build, test, and smoke checks are green.
