# CEOClaw Operational Truth Spine Execution Plan

Updated: 2026-03-21

This is the detailed implementation plan for the final productization step.
It is intentionally explicit and repetitive so that a weaker model can follow it safely.

Use this plan when you need to build the next large release milestone without losing the product spine.

For the strategy-level product intent, see [plans/2026-03-21-operational-truth-spine-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-21-operational-truth-spine-plan.md).
For the finish-line and release criteria, see [docs/release-ready-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/release-ready-plan.md).
For the canonical launch sequencing, see [docs/ceoclaw-launch-master-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/ceoclaw-launch-master-plan.md).

## 0. How to use this plan

Follow the phases in order.
Do not start the next phase until the current phase has passed its exit criteria.

For every phase:

- implement the smallest coherent slice that makes the feature useful;
- keep the UI compact and information-dense;
- keep Russian-first labels unless a technical self-name is better in English;
- update the README and the relevant plan doc after the feature lands;
- run the tests listed in the validation section;
- do a quick code-review pass before moving on;
- do not remove or rewrite working production surfaces just to make the new one fit;
- do not hide failures behind demo-only paths in user-facing flows.

If you discover that the current surface already solves the user problem well enough, do not add a duplicate.
Prefer enhancing the existing surface.

## 1. The product end-state we are building toward

CEOClaw should feel like one operational system with this flow:

`Goal -> Portfolio -> Finance -> Capacity -> Field evidence -> Docs -> Action -> Artifact`

The user should be able to:

- define goals and key results;
- see projects and initiatives roll up into those goals;
- read budget, forecast, and variance in one decision cockpit;
- understand who is overloaded and what happens if work changes;
- inspect GPS / GLONASS / photo / video evidence on a map and timeline;
- find documents and normative files in a Finder-like hub;
- convert any signal into a task, brief, escalation, or approval;
- export a board pack, presentation, whitepaper, or EVM workbook;
- install and use the product on web, macOS, and iPhone.

## 2. Existing baseline we must preserve

These are already real and should not be broken:

- AI council traces and replay;
- `/goals`;
- `/portfolio`;
- `/analytics`;
- `/documents`;
- `/field-operations`;
- `/chat`;
- `/release`;
- the compact sidebar and Russian-first navigation;
- the current EVM calculator / analytics layer;
- the `scripts/generate_evm.py` Excel export generator;
- the manifest-driven AI provider and connector layer;
- the desktop and iPhone shell paths.

The goal is to connect these pieces into one spine, not to start over.

## 3. Implementation rules

### 3.1 Product rules

- Every new screen must answer a user question.
- Every chart must support a decision.
- Every metric must have a context.
- Every signal must have an action.
- Every export must be reachable from a user-facing surface.
- Every mobile surface must stay usable at phone width.

### 3.2 Architecture rules

- Keep the Next.js + Prisma backend as the source of truth.
- Keep desktop and iPhone as thin shells over the live app.
- Keep the Python EVM generator as an export artifact, not the runtime core.
- Keep workspaces as context presets, not separate data stores.
- Keep AI traces durable and replayable.

### 3.3 Documentation rules

After each phase:

- update `README.md`;
- update the relevant plan doc;
- update any release or launch note that changed;
- keep the master plan and this execution plan in sync.

## 4. Phase 0. Baseline audit and alignment

Goal:
Make sure the repo, docs, and current UI state agree before adding more depth.

What to inspect:

- goal and portfolio pages;
- finance and EVM surfaces;
- documents hub tree and filters;
- field hub map and tab layout;
- AI chat cockpit and trace inspector;
- release page and download metadata;
- existing tests for these surfaces.

Tasks:

- check for duplicate concepts with different names;
- check for empty or stale views that look finished but are not;
- check for text overflow and oversized cards;
- check for missing nav entries or broken labels;
- check that any demo data still behaves as a preview, not as production truth.

Deliverables:

- a short audit note in the relevant plan doc;
- a clean baseline for the next phases;
- no broken screens.

Validation:

- `npm run build`
- `npm run test:run`
- `npx playwright test` on the critical flows you touched
- `git diff --check`

Exit criteria:

- there is no disagreement between the docs and the UI;
- the core flows still pass build and tests;
- the next phase can start without hidden layout surprises.

## 5. Phase 1. Strategy and portfolio spine

Goal:
Make goals and portfolio hierarchy feel like the product backbone.

User outcome:

- a manager can answer "what are we trying to achieve?" in one glance;
- a project can be traced to a goal or objective;
- the portfolio shows order, dependencies, and priority.

Build:

- formal objectives;
- key results with target and current states;
- initiative / program / project / milestone hierarchy;
- objective-to-project linking;
- compact rollup cards in dashboard and portfolio;
- delivery-order / dependency narrative;
- management-theme filter paths that jump from a goal to related projects.

Suggested code areas:

- `components/goals/*`
- `components/portfolio/*`
- `components/dashboard/*`
- `lib/*okr*`
- `lib/*portfolio*`
- any project-to-goal relation helpers

Validation:

- `/goals` loads and is readable without expansion;
- `/portfolio` shows the same goal truth as `/goals`;
- the dashboard shows a compact goal summary;
- linked projects are reachable from a goal filter;
- no large empty hero blocks remain on these surfaces.

Exit criteria:

- the user can see a goal, see what supports it, and see what is at risk;
- portfolio and goals no longer feel like separate ideas;
- build, tests, and a Playwright smoke pass.

Code review checklist:

- goals are readable in Russian-first copy;
- cards are compact and aligned;
- no duplicate goal models were introduced;
- the UI still feels dense, not airy;
- links and filters lead to real data, not placeholders.

## 6. Phase 2. Finance cockpit and EVM export

Goal:
Turn financial visibility into a real decision cockpit.

User outcome:

- a user can see budget, burn, variance, forecast, and EVM in one place;
- the user can export an Excel workbook when they need a shareable artifact;
- the Python generator is treated as export plumbing, not hidden logic.

Build:

- a dedicated finance view or a clearly labeled finance section in analytics;
- monthly plan-vs-fact variance;
- forecast at completion;
- burn trend / cash-flow style chart;
- CPI / SPI / EAC / ETC / VAC summary;
- a visible "export EVM workbook" action that uses `scripts/generate_evm.py`;
- a result screen or download toast that confirms the file was produced.

Suggested code areas:

- `app/finance/page.tsx` or the finance section inside analytics;
- `components/analytics/*`;
- `components/portfolio/*` for cross-links;
- `scripts/generate_evm.py`;
- `app/api/*evm*` if you add a route;
- `lib/plan-fact/service.ts`;
- `lib/evm/*`.

Implementation guidance:

- if you add a route, do not call `exec` with unescaped JSON in a shell string;
- prefer a safer spawn/file handoff pattern;
- keep the workbook export separate from the live dashboard calculations;
- preserve the existing charts and metrics if they already work.

Validation:

- the finance surface displays live numbers and not only placeholders;
- the EVM export downloads a valid `.xlsx` file;
- the workbook contains the expected sheets and formulas;
- the export path works from the UI, not only from the shell;
- the workbook file name is understandable to the user.

Exit criteria:

- executives can answer "are we safe?" from the finance cockpit;
- the exported workbook can be shared without manual repair;
- the finance view and EVM export match each other.

Code review checklist:

- financial formulas are not duplicated in incompatible ways;
- the live dashboard remains the source of truth for the UI;
- the export generator is stable and does not leak temp files;
- there is no hidden dependency on a dev-only script path;
- copy says "export" and "download" clearly.

## 7. Phase 3. Capacity and operating load

Goal:
Make resource planning real.

User outcome:

- the user can see who is overloaded;
- the user can see who has spare capacity;
- the user can understand what happens if assignments change.

Build:

- workload planner;
- capacity forecast by person, team, or skill;
- over-allocation warnings;
- time-off-aware planning;
- weekly timesheet UX;
- planned-vs-actual effort views;
- capacity summary cards in portfolio and analytics.

Suggested code areas:

- `components/team/*`
- `components/analytics/*`
- `components/portfolio/*`
- `lib/hooks/use-evm-metrics.ts`
- any capacity or allocation model code.

Validation:

- overloaded people are easy to identify;
- the capacity view is compact and readable;
- weekly effort can be reviewed without losing context;
- the view does not collapse into empty whitespace.

Exit criteria:

- capacity planning is usable in daily management;
- planning and actuals can be compared quickly;
- the user can make staffing decisions from the screen.

Code review checklist:

- allocation numbers match the intended meaning;
- weekly views do not overflow or waste space;
- empty states are helpful, not large and blank;
- no capacity feature is hidden in a tiny tooltip only.

## 8. Phase 4. Field evidence and map truth

Goal:
Make GPS / GLONASS / photo / video facts into one coherent field truth layer.

User outcome:

- the user can see where work is happening;
- the user can inspect evidence and freshness;
- the map is useful immediately on open.

Build:

- richer map markers with project names and evidence state;
- location-aware project markers;
- geofence state and freshness indicators;
- evidence timeline with provenance;
- video-fact review flow;
- field hub tabs for map, people, equipment, events, and media;
- quick filters for live / observed / waiting / geofence / site state.

Suggested code areas:

- `components/field-operations/*`
- `lib/field-operations/*`
- `lib/mock-data.ts` for preview data
- any GPS or evidence connectors

Validation:

- the map loads first and shows markers immediately;
- project markers have understandable names;
- the preview data is obvious when live data is unavailable;
- tabs remain compact and do not push the map down unnecessarily;
- the field hub remains usable on the desktop and phone layouts.

Exit criteria:

- the field hub tells the operator something useful in one screen;
- evidence and location can be connected to a project;
- the user can distinguish fresh data from stale data.

Code review checklist:

- map provider fallback remains safe;
- no hard dependency on a provider key breaks the page;
- labels are short and readable;
- the page still feels compact, not oversized.

## 9. Phase 5. Documents, search, and publishing

Goal:
Turn documents into a working knowledge and publishing system.

User outcome:

- the user can find the right file quickly;
- the user can separate app docs, normative docs, and project files;
- the user can export or generate a publishable artifact.

Build:

- compact Finder-like folder tree;
- file type filters and fast search;
- document categories for app docs, normative materials, project files, and archive;
- publishable artifact studio for board packs, articles, whitepapers, presentations;
- EVM workbook export entry point;
- template-driven starter kits.

Suggested code areas:

- `components/documents/*`
- `lib/documents/*`
- `memory/*` for doc-linked plans if needed
- `scripts/generate_evm.py`

Validation:

- folders are visible without extra clicks;
- no tree label overflows the sidebar pane;
- filters make the document list smaller and easier to scan;
- the document hub can show the new EVM branch and the generator script;
- a user can locate app docs and normative docs separately.

Exit criteria:

- the document hub feels like a real file system, not a list of cards;
- publishing outputs are easy to find and understand;
- EVM export is reachable from a user-facing place.

Code review checklist:

- the tree is compact and does not overflow;
- folder names are short enough to fit;
- search and filters do not hide core docs;
- the structure makes sense to a non-technical user.

## 10. Phase 6. Action and approval loop

Goal:
Make every signal lead to an action.

User outcome:

- a risk can become a task;
- an AI recommendation can become a brief or escalation;
- an intake request can move through approval states;
- the user always knows the next action.

Build:

- intake forms;
- approval steps and routing;
- action creation from AI insights;
- escalation and notification rules;
- a visible next-step path in briefs and work reports;
- tighter connection between AI traces and concrete follow-up objects.

Suggested code areas:

- `components/briefs/*`
- `components/work-reports/*`
- `components/ai/*`
- `components/command-center/*`
- `app/api/*` for any routing endpoints

Validation:

- an insight can be converted into a task or brief in one step;
- the approval state is visible and understandable;
- traces link to outputs instead of ending as dead-end analysis;
- the action path works on repeat.

Exit criteria:

- the product feels operational, not only observational;
- users can close the loop from signal to action without hunting across tabs.

Code review checklist:

- routing is clear and not over-engineered;
- human approval remains visible where it matters;
- AI suggestions are traceable;
- no action is created silently without user understanding.

## 11. Phase 7. Packaging and finish

Goal:
Make the product easy to install and support.

User outcome:

- a user can download the macOS app;
- a user can install the iPhone app;
- a user can find release notes and support without asking around.

Build:

- signed macOS artifact flow;
- iPhone archive / TestFlight / App Store flow;
- release page wired to real artifacts;
- release notes that match the actual build;
- smoke tests for `/release` and the distribution targets;
- one-page operator instructions.

Suggested code areas:

- `scripts/*release*`
- `docs/desktop-setup.md`
- `docs/mobile-app.md`
- `docs/release-ready-plan.md`
- `app/release/*`

Validation:

- the release page points to the right artifact;
- the desktop app installs on a clean Mac;
- the iPhone path is archive-ready on a machine with full Xcode;
- the release page and release notes match reality;
- the support path is obvious.

Exit criteria:

- the product is boring to install;
- support and rollback are documented;
- the release page is usable by a normal person.

Code review checklist:

- release text matches the actual build state;
- no stale download URL remains;
- packaging docs are accurate;
- the failure modes are honest.

## 12. Cross-cutting quality gates

These gates apply to every phase.

### 12.1 Build gate

- run `npm run build`;
- do not proceed if build fails;
- if the build emits warnings, record whether they are new or existing.

### 12.2 Test gate

- run `npm run test:run`;
- add or update unit tests for new logic;
- add Playwright smoke tests for touched user flows;
- if the UI changed, verify the changed screen visually.

### 12.3 Code review gate

Review the change for:

- correctness;
- readability;
- compact layout discipline;
- Russian-first copy where appropriate;
- no accidental feature removal;
- no duplicate or conflicting data model;
- no hidden demo fallback in production path.

### 12.4 Documentation gate

After each phase:

- update `README.md`;
- update the phase plan you touched;
- update release notes if user-visible behavior changed;
- keep the master plan and this execution plan in sync.

## 13. Practical execution order for a weaker model

If the next agent needs a very simple order, give it this:

1. Read this execution plan and the strategy plan.
2. Inspect the current code for the phase you are about to touch.
3. Make the smallest useful change.
4. Add or update tests.
5. Run build and tests.
6. Fix anything that fails.
7. Update the docs.
8. Write a short result note.
9. Move to the next phase only when the exit criteria are met.

## 14. What not to do

- Do not start with a rewrite.
- Do not add new agent roles before the product spine is clear.
- Do not let charts and cards grow larger when compactness is already a problem.
- Do not hide unfinished work behind invisible tabs or blank placeholders.
- Do not break the current working surfaces just because a new one is being added.
- Do not treat the EVM Excel exporter as the primary runtime analytics engine.
- Do not convert the iPhone track into a launch-critical on-device AI project.

## 15. Final definition of done for this execution plan

This plan is complete when:

- goals, portfolio, finance, capacity, field evidence, documents, actions, and artifacts are all connected;
- the UI is compact and readable;
- the finance export works;
- the field hub is actually useful;
- the documents hub feels like a real file system;
- AI recommendations produce follow-up actions;
- release packaging is boring and repeatable;
- build, tests, and smoke checks stay green.

