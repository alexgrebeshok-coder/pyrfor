# CEOClaw Operational Truth Spine Plan

Updated: 2026-03-21

This is the final large productization step for CEOClaw.
Its purpose is to turn the current live-first PMO core into one coherent operating system that answers five user questions clearly:

1. What are we trying to achieve?
2. What is the portfolio doing right now?
3. Are we on time, on budget, and resourced correctly?
4. What is happening in the field and what evidence supports it?
5. What should I do next, and what should I publish or share?

The current app already has strong pieces of this story:

- goals / OKR surfaces;
- portfolio cockpit;
- budgets, EVM, and forecast surfaces;
- capacity, risks, calendar, Gantt, and analytics;
- documents hub and search;
- field operations with map, GPS, geofence, and media context;
- AI council traces and replay;
- desktop and iPhone shells.

What is still incomplete is the spine that ties all of those parts together into one user-facing flow.

## 1. What the user still does not get clearly enough

Even with the current features, a user still has to mentally assemble the product.
That means the app is still missing a few obvious answers:

- strategic direction is visible, but not yet deeply operationalized as formal goals and rollups;
- financial truth is visible, but not yet packaged as a clear decision cockpit with forecast, variance, and export;
- resource pressure is visible, but not yet easy to plan against in one compact view;
- field evidence is visible, but not yet unified as a timeline of GPS, GLONASS, photo, and video facts;
- documents are searchable, but not yet fully organized as a working knowledge + normative + project file system;
- AI produces traces, but not yet consistently tied to one final action or artifact output;
- the product still needs a stronger "what do I do now?" layer for managers and executives.

That is the gap this plan closes.

## 2. Market context

Modern work-management products normalize the following expectations:

- explicit goals and OKRs;
- portfolio / roadmap hierarchy;
- workload and capacity planning;
- intake and approvals;
- docs, notes, and searchable knowledge;
- exportable reports and executive summaries;
- mobile-first readability;
- AI recommendations that lead to actions.

Official references used in the comparison:

- [Asana product page](https://asana.com/product)
- [ClickUp features page](https://clickup.com/features)
- [monday.com features page](https://monday.com/features)
- [Smartsheet home page](https://www.smartsheet.com/)
- [Jira features page](https://www.atlassian.com/software/jira/features)
- [Linear features page](https://linear.app/features)
- [Notion product page](https://www.notion.com/product)

CEOClaw already exceeds many of these tools in live traceability and evidence-oriented control.
The remaining work is to make that strength obvious in the UI and usable as one cohesive flow.

## 3. The spine we should finish

The final product should behave like an operational truth spine:

`Goal -> Portfolio -> Finance -> Capacity -> Field evidence -> Docs -> Action -> Artifact`

That means:

- goals roll up into the portfolio;
- portfolio rollups show budget, forecast, capacity, and risk;
- finance view shows EVM, monthly variance, burn, and forecast at completion;
- field operations show where work is happening and what evidence exists;
- documents and normative materials are searchable from one hub;
- AI turns signals into actions, approvals, or drafts;
- publishable artifacts can be created from live data when needed.

This is the final big step because it closes the loop from intent to evidence to action to communication.

## 4. Recommended architecture

### 4.1 One product spine, not separate silos

Keep one Next.js + Prisma backend as the source of truth.
Keep desktop and iPhone as thin shells around the live product.
Keep workspaces as context presets, not as separate data stores.

### 4.2 The main surfaces

- `Панель управления` as the system entry point;
- `Цели` as the strategic layer;
- `Портфель` as the portfolio / roadmap cockpit;
- `Финансы` as the budget / EVM / forecast cockpit;
- `Поля и логистика` as the GPS / GLONASS / video / geofence layer;
- `Документы` as the Finder-like knowledge and normative hub;
- `ИИ-чат` as the AI action cockpit;
- `Аналитика` as the reporting and decision layer;
- `Release` as the install and support surface.

### 4.3 Compactness rules

The UI should stay information-dense:

- avoid oversized empty hero blocks where one small list would do;
- prefer compact cards with clear labels and visible state;
- keep the sidebar collapsible and tight by default;
- use progressive disclosure only where the user genuinely needs drill-down;
- make first screens answer something useful immediately.

## 5. What to build next

### Phase 1. Strategy and portfolio spine

Build a formal goal model and connect it to the portfolio.

Deliverables:

- objectives and key results;
- initiative / program / project / milestone hierarchy;
- goal rollups in dashboard and portfolio;
- dependency and delivery-order view;
- compact executive summary cards.

Why this first:

- it gives the user a clear strategic frame;
- it turns "projects" into "business outcomes";
- it makes the rest of the app easier to understand.

### Phase 2. Finance and decision cockpit

Turn EVM and budgets into a real finance cockpit.

Deliverables:

- forecast at completion;
- monthly plan-vs-fact variance;
- burn trend and cash-flow style view;
- CPI / SPI / EAC / ETC / VAC in one place;
- export to Excel through the existing `generate_evm.py` flow;
- keep the Python generator as an export artifact, not the primary engine of truth.

Why this matters:

- executives need to see "are we safe?" not just raw cost numbers;
- EVM becomes a usable decision tool;
- the Excel export becomes a shareable artifact, not a hidden utility.

### Phase 3. Capacity and operating load

Add workload, utilization, and timesheet control.

Deliverables:

- workload planner;
- over-allocation detection;
- time-off-aware capacity forecasting;
- weekly timesheet UX;
- planned-vs-actual effort views.

Why this matters:

- users need to know who is overloaded before the project slips;
- resource planning becomes real instead of decorative.

### Phase 4. Evidence and field truth

Unify GPS, GLONASS, photos, video, and geofences into one field truth flow.

Deliverables:

- a stronger field hub with map, people, equipment, events, and media;
- video-fact review flow;
- evidence timeline with provenance;
- geofence state and freshness indicators;
- location-aware project markers and field summaries.

Why this matters:

- this is one of CEOClaw's real differentiators;
- the product becomes stronger for construction, logistics, infrastructure, and field-heavy enterprises;
- the user can see where work is happening, not just read about it.

### Phase 5. Documents, search, and publishing

Turn the documents surface into a working knowledge system.

Deliverables:

- compact Finder-like folder tree;
- type filters and fast search;
- distinction between app docs, normative docs, and project files;
- article / whitepaper / presentation / board-pack studio;
- EVM Excel export entry point from finance or documents;
- template-driven starter kits.

Why this matters:

- users need to find things fast;
- leadership needs publishable outputs from live data;
- the app should help people communicate, not just store content.

### Phase 6. Action and approval loop

Make every signal lead to something actionable.

Deliverables:

- intake forms;
- routing and approvals;
- one-click conversion of insights into tasks or briefs;
- escalation and notification rules;
- AI suggestions with traceable source and clear next step.

Why this matters:

- dashboards without action are just decoration;
- the original AI-PMO idea was always about a second governance loop.

### Phase 7. Packaging and finish

Close the delivery path.

Deliverables:

- signed macOS artifact flow;
- iPhone archive / TestFlight path;
- release page wired to actual artifacts;
- smoke tests for web, desktop, iPhone, and the release hub;
- one-page operator instructions.

Why this matters:

- the product is not done until it is easy to install and easy to operate.

## 6. What to postpone

Do not spend the next cycle on:

- extra agent roles before the core spine is clear;
- more charts that do not lead to decisions;
- on-device iPhone AI as a launch-critical task;
- separate rewrites for desktop or mobile;
- hidden demo-only data paths in production surfaces.

## 7. Definition of done

CEOClaw is functionally finished when a new user can:

- set a goal;
- see that goal roll up into the portfolio;
- read finance and forecast numbers with confidence;
- understand workload and capacity pressure;
- inspect field evidence and map context;
- find documents and normative materials instantly;
- turn an insight into a task, brief, or escalation;
- export an executive artifact or EVM workbook;
- install and use the app on desktop and phone without asking for manual setup.

## 8. Related docs

- [plans/2026-03-21-operational-truth-spine-execution-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-21-operational-truth-spine-execution-plan.md)
- [docs/release-ready-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/release-ready-plan.md)
- [docs/ceoclaw-launch-master-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/ceoclaw-launch-master-plan.md)
- [plans/2026-03-20-market-gap-ux-roadmap.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-market-gap-ux-roadmap.md)
- [plans/2026-03-20-skeleton-freeze-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-skeleton-freeze-plan.md)
- [memory/EVM-INTEGRATION-DASHBOARD.md](/Users/aleksandrgrebeshok/ceoclaw-dev/memory/EVM-INTEGRATION-DASHBOARD.md)
- [docs/ai-pmo-severoavtodor-origin-gap-analysis.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/ai-pmo-severoavtodor-origin-gap-analysis.md)
