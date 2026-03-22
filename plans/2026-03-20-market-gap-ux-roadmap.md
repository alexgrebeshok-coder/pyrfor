# CEOClaw Market Gap and UX Roadmap

Updated: 2026-03-20

This roadmap compares CEOClaw against current market expectations from Asana, ClickUp, monday.com, Smartsheet, Jira, Linear, and Notion, then turns that comparison into a prioritized product-improvement plan.

The goal is not to imitate competitors feature-for-feature.
The goal is to close the user-experience gaps that still matter after we already have a live-first enterprise PMO core.

## 1. Executive summary

CEOClaw is already unusually strong in:

- AI governance, council traces, approvals, and replay;
- live enterprise truth from connectors and evidence layers;
- project/task/risk/calendar/Gantt operations;
- budget, portfolio health, resource visibility, and executive briefs;
- desktop/iPhone shell delivery;
- manifest-driven integration onboarding for AI providers and connectors.

What is still missing is not "more PM features" in the generic sense.
What is missing is the user-facing structure that competitors use to make the product feel complete:

- explicit goals and OKRs;
- a stronger portfolio/program/roadmap layer;
- deeper resource planning and time tracking;
- more finance/forecast surfaces;
- better intake and approval portals;
- a productized knowledge and publishing studio;
- stronger search and cross-object navigation;
- more polished mobile-first interaction.

If we close those gaps, CEOClaw becomes easier to understand, easier to trust, and easier to adopt.

For the language-and-readability execution companion that keeps the visible UI Russian-first, see [plans/2026-03-20-ux-language-quality-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-ux-language-quality-plan.md).
For the narrower "lock the skeleton" roadmap that turns this analysis into a minimum stable product spine, see [plans/2026-03-20-skeleton-freeze-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-skeleton-freeze-plan.md).

## 2. What competitors normalize

### Asana

Asana sets a clear expectation that work should connect to company-wide goals, reporting, and resource management.
Its product page explicitly emphasizes goals and reporting, resource management, AI teammates, and company objectives.

Official source:

- [Asana product page](https://asana.com/product)

### ClickUp

ClickUp normalizes the "everything app" expectation:

- docs and wikis;
- dashboards and rollups;
- goals and portfolios;
- workload view;
- time tracking and timesheets;
- AI agents and notetaking;
- templates;
- connected search.

Official source:

- [ClickUp features page](https://clickup.com/features)

### monday.com

monday.com pushes an AI-first operating model:

- projects and portfolio management;
- AI reporting;
- AI risk analysis;
- Workdocs;
- dashboards;
- automations;
- forms;
- Gantt;
- roadmap planning;
- open integrations and MCP support.

Official source:

- [monday.com features page](https://monday.com/features)

### Smartsheet

Smartsheet frames the product around intelligent work management, portfolio visibility, resource planning, dashboards, reporting, centralized intake, and approval workflows.

Official source:

- [Smartsheet home page](https://www.smartsheet.com/)

### Jira

Jira emphasizes planning, goals, dependencies, forms, automation, AI-assisted reporting, capacity, and cycle-time style decision making.

Official source:

- [Jira features page](https://www.atlassian.com/software/jira/features)

### Linear

Linear presents a very crisp product-development flow:

- roadmap to release;
- issue tracking and cycles;
- AI agents;
- insights;
- customer requests;
- mobile support.

Official source:

- [Linear features page](https://linear.app/features)

### Notion

Notion is the strongest reference for knowledge-work consolidation:

- AI workspace;
- agents;
- knowledge base;
- docs;
- enterprise search;
- meeting notes;
- projects;
- integrations.

Official source:

- [Notion product page](https://www.notion.com/product)

## 3. What CEOClaw already covers well

These current surfaces already beat many competitors in trust and operational honesty:

- [components/ai/ai-run-inspector.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/ai/ai-run-inspector.tsx)
- [components/briefs/briefs-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/briefs/briefs-page.tsx)
- [components/work-reports/work-reports-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/work-reports/work-reports-page.tsx)
- [components/integrations/integrations-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/integrations/integrations-page.tsx)
- [components/dashboard/dashboard-home.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/dashboard/dashboard-home.tsx)
- [components/analytics/analytics-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/analytics/analytics-page.tsx)
- [components/projects/project-detail.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/projects/project-detail.tsx)

In plain terms, we already have:

- live-first AI council and traceability;
- projects, tasks, risks, calendar, Gantt, and budget views;
- portfolio health, utilization, EVM-style metrics, and financial snapshots;
- a dedicated executive portfolio cockpit at `/portfolio` with goals, budget, resources, timeline, and risk surfaces;
- evidence, reconciliation, and connector truth layers;
- executive briefs and work-report signal packets;
- native desktop and iPhone shells.

## 4. Gap analysis by theme

| Theme | Market expectation | CEOClaw today | What to add next | Priority |
| --- | --- | --- | --- | --- |
| Strategy and goals | Asana/ClickUp/Jira expect explicit goals and rollups | Portfolio health exists, but no first-class goal/OKR model | Add Objectives, Key Results, initiative mapping, and goal rollups into dashboards | P0 |
| Portfolio and roadmap | monday/Smartsheet/Linear expect a portfolio and roadmap layer | Projects and Gantt exist, but no dedicated roadmap cockpit | Add portfolio cockpit, roadmap timeline, dependency graph, and cross-project milestone rollups | P0 |
| Resource and capacity planning | Asana/ClickUp/Smartsheet expect workload, capacity, and utilization planning | Utilization exists, but planning is still shallow | Add workload planner, over-allocation detection, skill filters, and time-off-aware capacity forecast | P0 |
| Time tracking and actuals | ClickUp normalizes timers, timesheets, and approvals | We have timer/time-entry primitives, but not a strong timesheet UX | Add weekly timesheets, approvals, and planned-vs-actual effort views | P1 |
| Finance and forecasting | Smartsheet and Asana normalize better financial visibility | We have budgets, EVM, and snapshots, but not a finance cockpit | Add forecast at completion, burn trend, monthly variance, and cash-flow style views | P0 |
| Intake and approvals | Jira/Smartsheet normalize forms and request portals | We have some forms, but not a dedicated intake system | Add request intake, routing, SLA, approval chain, and templates | P1 |
| Knowledge and publishing | ClickUp and Notion normalize docs, wikis, notes, and meeting capture | We have briefs and reports, but not a productized knowledge studio | Add publishable artifact studio for board packs, articles, whitepapers, and presentations | P0 |
| Search and navigation | Notion/ClickUp/Linear normalize fast connected search | Search exists, but it is not yet the main command surface | Add universal search, command palette, and cross-object jump links | P1 |
| Evidence and field truth | CEOClaw origin story values evidence, GPS, and video facts | GPS/1C/evidence exist, video truth depth is still weakest | Add a dedicated evidence timeline, video-fact review flow, and corroboration UX | P1 |
| Field and geo operations | Construction and infrastructure teams expect map-aware field context | GPS/evidence exist, but there is no dedicated field hub or map surface | Add `Поля и логистика` with map, people, equipment, geofences, events, and media tabs | P1 |
| Mobile UX | Linear and the major PM tools feel usable on mobile | iPhone shell exists, but the product still reads desktop-first in some places | Add phone-first navigation, compact action surfaces, and better touch-safe states | P1 |
| Templates and onboarding | ClickUp and Asana reduce friction with templates and guided setup | We have onboarding and docs, but not enough guided templates | Add role/industry templates, starter kits, and scenario-based setup | P1 |
| Executive communication | Smartsheet, monday, and Asana push reporting and stakeholder updates | Briefs exist, but board-pack storytelling can be stronger | Add an executive pack builder with export, delivery, and narrative controls | P0 |

## 5. Recommended product moves

### P0. Add the missing executive spine

This is the shortest path to a noticeably better product.

Deliverables:

- Goals / OKRs entity and UI;
- portfolio cockpit with roadmap, milestone rollups, budget, forecast, capacity, and risk in one place. The first cut is already shipped at `/portfolio`; the next step is to connect it to a formal goal model and richer what-if comparison;
- finance cockpit with forecast, variance, and EAC-style views;
- publishable artifact studio for executive packs, whitepapers, and presentation outputs;
- stronger universal search entry point.

Why this matters:

- users immediately understand "why" the work exists;
- executives get a single place to read the state of the business;
- the app stops feeling like several good screens and starts feeling like one system.

### P1. Add the control surfaces competitors already expect

Deliverables:

- workload planner and capacity simulation;
- weekly timesheets and approval flow;
- intake forms and request routing;
- better evidence/video-fact review;
- onboarding templates and starter kits;
- mobile-first navigation pass;
- cross-object command palette.
- dedicated field/geo hub with map, people, equipment, and geofences;

Why this matters:

- users spend less time reconciling data by hand;
- manager and PMO workflows become easier to run daily;
- mobile use becomes believable rather than merely available.

### P2. Add the differentiators that make CEOClaw memorable

Deliverables:

- richer scenario planning for portfolio trade-offs and goal-driven what-if analysis;
- board-pack generation from live data and AI council traces;
- stronger publish/subscribe automation for Telegram, email, and other connectors;
- field evidence review center with video fact confidence;
- richer dependency mapping and what-if analysis;
- more productized templates by industry.

Why this matters:

- these are the features that turn CEOClaw from "another PM tool" into an operating system for PMO and enterprise control.

## 6. Product principles for the next iteration

- One surface should answer one primary question.
- Every chart should exist to drive a decision, not to decorate the page.
- Every AI recommendation should have a visible source and a clear action.
- Every project should be traceable to a goal or portfolio objective.
- Every important number should have a planned, actual, and forecast view.
- Every workflow should have a visible approval state.
- Mobile should always have a safe, reduced, usable version of the same system.

## 7. Suggested success metrics

- percentage of projects linked to a goal or objective;
- percentage of active work with resource/capacity coverage;
- percentage of projects with current financial forecast;
- number of executive packs generated per month;
- time from first login to first meaningful action;
- mobile task completion rate;
- percentage of requests entering through structured intake instead of ad hoc chat;
- percentage of AI runs reopened through trace/replay.

## 8. Source links used for the comparison

- [Asana product page](https://asana.com/product)
- [ClickUp features page](https://clickup.com/features)
- [monday.com features page](https://monday.com/features)
- [Smartsheet home page](https://www.smartsheet.com/)
- [Jira features page](https://www.atlassian.com/software/jira/features)
- [Linear features page](https://linear.app/features)
- [Notion product page](https://www.notion.com/product)

## 9. Internal context used for the CEOClaw comparison

- [README.md](/Users/aleksandrgrebeshok/ceoclaw-dev/README.md)
- [docs/release-ready-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/release-ready-plan.md)
- [docs/ceoclaw-launch-master-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/ceoclaw-launch-master-plan.md)
- [docs/ai-pmo-severoavtodor-origin-gap-analysis.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/ai-pmo-severoavtodor-origin-gap-analysis.md)
- [components/dashboard/dashboard-home.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/dashboard/dashboard-home.tsx)
- [components/analytics/analytics-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/analytics/analytics-page.tsx)
- [components/analytics/portfolio-health-card.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/analytics/portfolio-health-card.tsx)
- [components/projects/project-detail.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/projects/project-detail.tsx)
- [components/briefs/briefs-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/briefs/briefs-page.tsx)
- [components/work-reports/work-reports-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/work-reports/work-reports-page.tsx)
- [components/integrations/integrations-page.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/integrations/integrations-page.tsx)
- [components/ai/ai-run-inspector.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/ai/ai-run-inspector.tsx)
