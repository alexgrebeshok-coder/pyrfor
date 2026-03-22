# CEOClaw Skeleton Freeze Plan

Updated: 2026-03-20

This plan defines the minimum product skeleton that should be locked before we move into the later expansion stages.

The goal is not to keep adding screens forever.
The goal is to make CEOClaw feel like one coherent operating system for projects, enterprise control, and delivery outcomes.

This plan is based on three inputs:

- what CEOClaw already does well today;
- what strong competitors normalize in the market;
- what users need in order to understand, trust, and use the app every day.

For the broader competitor/UX comparison, see [plans/2026-03-20-market-gap-ux-roadmap.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-market-gap-ux-roadmap.md).
For the Russian-first readability pass that keeps the UI understandable, see [plans/2026-03-20-ux-language-quality-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-ux-language-quality-plan.md).
For the screen-by-screen implementation route, see [plans/2026-03-20-skeleton-freeze-execution-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-skeleton-freeze-execution-plan.md).

## 1. What competitors normalize

Strong project and work-management products usually make these things feel obvious:

- goals and rollups that connect daily work to company objectives;
- portfolio and roadmap views that show initiatives, milestones, and dependencies;
- workload, capacity, and time tracking so managers can plan realistically;
- intake forms, approvals, and routing so work does not enter the system as chaos;
- dashboards and reporting that answer "what changed?", "what is at risk?", and "what do we do next?";
- docs, meeting notes, knowledge, and search so the system also holds context;
- templates and starter kits so users do not rebuild every workflow from scratch;
- mobile-friendly interaction so the same system is usable on a phone;
- AI assistance that recommends actions, but still shows traceability and control.

Official comparison sources:

- [Asana product page](https://asana.com/product)
- [ClickUp features page](https://clickup.com/features)
- [monday.com features page](https://monday.com/features)
- [Smartsheet home page](https://www.smartsheet.com/)
- [Jira features page](https://www.atlassian.com/software/jira/features)
- [Linear features page](https://linear.app/features)
- [Notion product page](https://www.notion.com/product)

## 2. What CEOClaw already has

CEOClaw already has the parts that many competitors do not make as honest or traceable:

- live AI council and replayable traces;
- project/task/risk/calendar/Gantt surfaces;
- portfolio cockpit with goals, budget, resources, timeline, and risk;
- briefs, meeting-to-action, work reports, and exception handling;
- live connectors and evidence-oriented truth layers;
- desktop and iPhone shells;
- release/download hub;
- Russian-first language cleanup for the core surfaces.

That means the skeleton is not empty.
What is missing is the set of stable, user-facing structures that make the product feel complete and repeatable.

## 3. The missing skeleton pieces

These are the surfaces that should be treated as part of the core skeleton, not as optional extras:

1. Goals and OKRs.
- Every project should be traceable to an objective.
- The portfolio should roll up into a small number of visible business goals.

2. Portfolio / roadmap hierarchy.
- The product needs a clean initiative / program / project / milestone structure.
- Portfolio planning should show dependency chains and delivery order, not just project cards.

3. Finance cockpit.
- Users need plan, fact, variance, burn trend, and forecast at completion in one place.
- Budget visibility should move from "snapshot" to "decision support".

4. Capacity and timesheets.
- Managers need to see who is overloaded, who has spare capacity, and what happens if assignments change.
- Time entry needs to become a friendly weekly surface, not only a raw data primitive.

5. Intake and approvals.
- New work should arrive through forms, requests, routing, and approval states.
- Ad hoc chat requests should not be the only entry point into the system.

6. Universal search and command palette.
- The app should let users jump to projects, briefs, risks, releases, and settings immediately.
- Search should feel like a primary control surface, not a secondary page.

7. Executive artifact studio.
- Users should be able to turn live data into board packs, whitepapers, presentations, and release notes.
- This is the missing bridge between operational data and executive communication.

8. Templates and starter kits.
- Users should be able to start from role-based and industry-based templates.
- That will reduce onboarding friction and make the product feel "ready" instead of "assembled".

9. Action-from-insight.
- Any alert, risk, or recommendation should be able to become a task, brief, meeting action, or escalation in one click.
- Signals must lead to action, otherwise they are just dashboards.

10. Mobile-first readability.
- The phone shell should default to a reduced, touch-safe, decision-friendly experience.
- The same business logic should be visible, but with less noise and fewer dense tables.

## 4. Recommended build order

### Phase A. Lock the strategic backbone

Build these first:

- Goals / OKRs model with rollups to portfolio and projects;
- roadmap and program hierarchy;
- finance cockpit with forecast and variance;
- action-from-insight hooks for risks and recommendations.

Why this first:

- this gives the product a business spine;
- executives can finally see how work maps to outcomes;
- the rest of the UI has a clear story.

### Phase B. Lock the operating system layer

Build these next:

- capacity planner;
- weekly timesheets;
- intake forms and approval routing;
- universal search and command palette;
- templates and starter kits.

Why this next:

- this makes the app usable every day, not just impressive in demos;
- it reduces manual coordination overhead;
- it turns CEOClaw into a working system, not a collection of views.

### Phase C. Lock the communication layer

Build these after the operating core is stable:

- executive artifact studio;
- board pack / presentation generation;
- knowledge publish flows;
- role-based digests and summaries;
- richer saved views by persona.

Why this matters:

- many organizations do not fail on data collection;
- they fail on turning data into decisions and communication.

### Phase D. Polish the shared surfaces

Finish with:

- mobile-first refinements;
- better empty/loading/error states;
- tighter Russian-first microcopy;
- clearer default dashboards per role;
- small UX simplifications in menus and cards.

Why this last:

- these improvements matter a lot;
- but they are more effective once the skeleton underneath is stable.

## 5. What to postpone

Do not spend the next cycle on:

- more disconnected charts that do not lead to actions;
- extra agent roles before the core product surface is coherent;
- custom mobile on-device AI for iPhone as a launch-critical task;
- new standalone flows that do not roll up into goals, portfolio, finance, or action management.

## 6. Definition of done for the skeleton

We can say the skeleton is locked when a user can:

- set a goal;
- see initiatives and projects roll up to that goal;
- review the portfolio roadmap and the financial forecast;
- check capacity and time usage;
- route new work through intake;
- search the system instantly;
- turn a risk or AI recommendation into a real action;
- export an executive artifact;
- use the same system comfortably on desktop and phone.

At that point the platform is structurally complete enough to support the remaining stages.

## 7. Success metrics

- percentage of projects linked to objectives;
- percentage of active work with forecast and capacity coverage;
- percentage of requests entering through structured intake;
- percentage of AI recommendations converted into actions;
- average time to locate a project, risk, or brief;
- usage of templates vs. empty-start creation;
- mobile completion rate for common actions;
- number of executive artifacts generated from live data.

## 8. Canonical related plans

- [plans/2026-03-20-market-gap-ux-roadmap.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-market-gap-ux-roadmap.md)
- [plans/2026-03-20-ux-language-quality-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/plans/2026-03-20-ux-language-quality-plan.md)
- [docs/release-ready-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/release-ready-plan.md)
- [docs/ceoclaw-launch-master-plan.md](/Users/aleksandrgrebeshok/ceoclaw-dev/docs/ceoclaw-launch-master-plan.md)
