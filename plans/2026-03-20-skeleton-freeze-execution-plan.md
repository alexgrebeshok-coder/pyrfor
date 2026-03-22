# CEOClaw Skeleton Freeze Execution Plan

Updated: 2026-03-20

This is the concrete implementation route for the skeleton freeze.

The goal is to turn the current analysis into screen-by-screen work that locks the minimum stable product spine before we expand into later stages.

For the strategic definition of what belongs in the skeleton, see [plans/2026-03-20-skeleton-freeze-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-skeleton-freeze-plan.md).
For the broader market comparison, see [plans/2026-03-20-market-gap-ux-roadmap.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-market-gap-ux-roadmap.md).
For the Russian-first readability companion, see [plans/2026-03-20-ux-language-quality-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-ux-language-quality-plan.md).

## 1. What we are trying to lock

By the end of this stage, CEOClaw should feel like one coherent product, not a bundle of strong screens.

The user should be able to:

- set a goal and see it roll up into a project, program, or portfolio;
- understand where time, money, and capacity are going;
- route new work through a structured intake;
- turn a signal into a real action without hunting across tabs;
- search and jump across the system immediately;
- produce an executive artifact from live data;
- use the same system comfortably on desktop and phone.

## 2. Screen-by-screen execution map

| Screen / surface | User need | What to add next | Data / model impact | Priority |
| --- | --- | --- | --- | --- |
| Goals / OKR | "What are the company goals?" | Goal overview, key results with current/target levels, project linkage, and управленческий фокус with a visible priority card | `Objective`, `KeyResult`, `InsightAction` rollups | P0 |
| Dashboard | "What is happening now?" | Goal summary, executive changes, action shortcuts, top portfolio risks, and a compact map-and-logistics widget for quick site awareness | `Objective`, `KeyResult`, `InsightAction` rollups | P0 |
| Portfolio cockpit | "What matters most?" | First-class goals, roadmap hierarchy, scenario compare, stronger forecast and budget narrative | `Objective`, `Initiative`, `Program`, `ForecastSnapshot` | P0 |
| Project detail | "How is this project really doing?" | Objective link, milestone dependency view, action-from-insight cards, evidence timeline | `ObjectiveLink`, `Dependency`, `EvidenceItem` | P0 |
| Analytics | "Where are we off track?" | Plan/fact/forecast charts, variance commentary, what-if scenarios, capacity pressure map | `FinanceSnapshot`, `CapacityForecast`, `Scenario` | P0 |
| Team / capacity | "Who can do the work?" | Workload planner, time-off-aware capacity, allocation warnings, weekly timesheets | `CapacityPlan`, `Timesheet`, `Allocation` | P0 |
| Briefs / meetings / command center | "How do I turn signals into action?" | Intake forms, approvals, routing, action capture, board-pack output | `IntakeRequest`, `ApprovalStep`, `ExecutiveArtifact` | P0 |
| Search / command palette | "Take me there now" | Universal search, quick jump, recent items, object command actions | `SavedSearch`, `CommandShortcut` | P1 |
| Documents / knowledge hub | "Where is the right file?" | Finder-like document center, app docs, normative docs, project files, preview pane, and quick search | `DocumentHubItem`, `DocumentFolder` | P1 |
| Release hub | "How do I install and get help?" | Clear install steps, support, release notes, platform-specific guidance | mostly copy / presentation changes | P1 |
| Mobile shell | "Can I use this on a phone?" | Touch-safe navigation, fewer dense tables, action-first cards, compact summaries | shared data, mobile view models | P1 |

## 3. Data model backbone

These are the core entities that should be stable before the product expands further.

### Strategy layer

- `Objective`
- `KeyResult`
- `Initiative`
- `Program`
- `ObjectiveLink`

### Delivery layer

- `ProjectMilestone` or a richer milestone view
- `Dependency`
- `Risk`
- `InsightAction`
- `EvidenceItem`

### Operations layer

- `CapacityPlan`
- `Allocation`
- `Timesheet`
- `IntakeRequest`
- `ApprovalStep`

### Financial layer

- `FinanceSnapshot`
- `ForecastSnapshot`
- `BudgetVariance`
- `Scenario`

### Communication layer

- `ExecutiveArtifact`
- `ArtifactTemplate`
- `SavedSearch`
- `CommandShortcut`

## 4. Sprint plan

### Sprint 1. Strategic backbone

Goal:
- make goals and roadmap hierarchy visible in the product.
- make the dashboard show a quick map-and-logistics summary instead of hiding field context behind another page.

Status:
- the first live `/goals` surface is implemented and smoke-tested; the remaining goal rollups and roadmap depth continue in this sprint.
- the dashboard and goals surfaces now stay usable in auth-soft or partially degraded mode instead of hiding core navigation behind a full error state.
- the portfolio cockpit now shows a live finance forecast and capacity outlook, so managers can read plan/fact/forecast and utilization in one place instead of hunting across analytics.
- the portfolio cockpit also adds a short scenario compare block, so users can see what changes if CPI returns to 1.00 or if capacity is pulled back to a safe 80% load.
- the goals screen now surfaces a clear priority card and key result cards that link objectives to budget and capacity pressure, plus an objective filter strip that lets the user jump from a management theme to the related projects immediately, so the user sees which contour needs attention first, what the target level is, and where it lives in the portfolio.

Deliverables:

- add a first-class `/goals` screen derived from current project objectives and portfolio signals;
- add Objective and Key Result surfaces;
- link projects and initiatives to goals;
- add objective rollups to portfolio and dashboard;
- show goal progress in plain language.

Suggested screens:

- `/goals`
- `/portfolio`
- `/dashboard`
- `/projects/[id]`

Exit criteria:

- a user can tell what the business is trying to achieve;
- the portfolio visibly rolls up into those objectives;
- the dashboard shows goal progress without opening separate pages.

### Sprint 2. Finance and capacity

Goal:
- make the app useful for real planning, not only reporting.

Deliverables:

- finance cockpit with plan / fact / variance / forecast;
- workload planner and allocation warnings;
- weekly timesheet view;
- time-off-aware capacity forecast.

Suggested screens:

- `/analytics`
- `/team`
- `/portfolio`

Exit criteria:

- managers can see overloaded people;
- finance view can answer "how much budget is left?" and "where are we going?";
- the system can show planned versus actual effort in a readable way.

### Sprint 3. Intake and control flow

Goal:
- replace ad hoc requests with a structured path.

Deliverables:

- request intake form;
- approval chain;
- routing rules;
- action capture from signals and AI recommendations;
- stronger command surface for next steps.

Suggested screens:

- `/briefs`
- `/meetings`
- `/command-center`
- `/search`

Exit criteria:

- signals can become tasks or escalations in one step;
- users can understand the status of an incoming request;
- the product feels like it helps run the day, not just report it.

### Sprint 4. Knowledge and publishing

Goal:
- make the system produce artifacts that stakeholders can consume.

Deliverables:

- executive artifact studio;
- board pack / whitepaper / presentation outputs;
- templates and starter kits;
- role-based summary generation.

Suggested screens:

- `/briefs`
- `/work-reports`
- `/release`

Exit criteria:

- a user can turn live data into a shareable artifact;
- templates reduce blank-page friction;
- executive communication no longer requires manual copy-paste from many screens.

### Sprint 5. Mobile and polish

Goal:
- make the whole system comfortable on the phone and more forgiving overall.

Deliverables:

- mobile-friendly navigation refinements;
- compact cards and summaries;
- friendlier empty, loading, and error states;
- clearer CTA language;
- final Russian-first copy cleanup for the remaining mixed-language surfaces.

Suggested screens:

- `/dashboard`
- `/portfolio`
- `/release`
- `/chat`
- `/settings`

Exit criteria:

- a user can complete common actions on a phone without fighting the layout;
- the product still feels like the same product on every device;
- the visible language is consistent and readable.

## 5. UX rules for every new screen

1. One screen, one primary question.
- If the page is about goals, make goals impossible to miss.
- If the page is about finance, show the numbers that matter first.

2. Every signal needs an action.
- No card should end with "interesting information" only.
- Each warning, recommendation, or insight should offer a next step.

3. Prefer plain language.
- Use Russian-first visible copy.
- Keep self-names and technical terms only when translation would make them worse.

4. Show planned, actual, and forecast where it matters.
- This is especially important for budget, time, and delivery confidence.

5. Preserve trust.
- If data is missing, say so clearly.
- Never hide degraded state behind decorative UI.

## 6. Recommended build order in the codebase

1. Extend the data model and APIs for Objectives / OKRs.
2. Wire goal rollups into dashboard and portfolio.
3. Add finance forecast and capacity surfaces.
4. Build intake / approval flow and action-from-insight actions.
5. Add search / command palette as a first-class control surface.
6. Add artifact studio and template-driven publishing.
7. Polish the mobile shell and language consistency last.

## 7. Verification plan

After each major batch:

- run `npm run build`;
- run `npm run test:run`;
- run the relevant Playwright smoke for the affected surface;
- confirm `git diff --check`;
- do a visual spot-check in the browser or desktop shell.

## 8. What not to do yet

- do not add more agent roles before the new product skeleton is stable;
- do not expand on-device AI for iPhone as a launch-critical path;
- do not add charts that do not support a decision;
- do not create duplicate screens for the same object if the current screen can be extended cleanly.

## 9. Success definition

This execution stage is done when:

- goals exist and roll up clearly;
- portfolio planning feels business-driven;
- finance and capacity are readable in plain language;
- requests and signals can become actions;
- search is immediate;
- artifacts are exportable;
- mobile use is believable;
- the app feels structurally complete enough for the later expansion stages.
