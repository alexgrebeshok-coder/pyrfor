# CEOClaw UX and Language Quality Plan

Updated: 2026-03-20

This plan turns the current product gap analysis into a practical user-experience and language-quality execution route.

The goal is simple:

- make CEOClaw easier to read at a glance;
- make every major screen answer "what is this?" and "what do I do next?";
- keep the visible UI Russian-first unless a name is a self-name, API term, brand, or technical standard;
- preserve the same shared product core across web, desktop, and iPhone.

## 1. Principles

1. Russian-first visible copy.
- Translate menus, headings, cards, empty states, buttons, chips, and helper text into Russian wherever possible.
- Keep self-names and technical terms intact when translation would make them worse: CEOClaw, AI, MLX, Tauri, Capacitor, EVM, CPI, SPI, Telegram, SMTP, App Store, TestFlight.

2. Actions over labels.
- Every major surface should show the next useful action, not only the status.
- If a screen shows a signal, it should also show the follow-up.

3. One screen, one job.
- Each page should make its primary purpose obvious in the first fold.
- Avoid mixed-language labels and vague English phrases that feel internal rather than customer-facing.

4. Shared behavior everywhere.
- The same project, task, risk, brief, and AI trace should read consistently on web, desktop, and iPhone.
- Copy changes should improve all surfaces at once unless a platform needs special wording.

## 2. What we improve first

### Phase 1. Language cleanup on high-traffic surfaces

Target areas:

- sidebar and top navigation;
- dashboard and portfolio cockpit;
- documents hub and file search;
- briefs and delivery panels;
- meeting-to-action intake;
- command center and exception inbox;
- release / downloads hub;
- AI chat cockpit, status, drawer, and trace labels;
- settings and help entry points.

Acceptance rule:

- a non-technical user should be able to read the page without hitting unexplained English labels in the main UI.

### Phase 2. Make the product more readable and more useful

Target improvements:

- turn signals into next actions;
- add stronger goal / OKR framing where users need context;
- show finance plan, fact, variance, and forecast in plain language;
- simplify empty, loading, error, and preview states;
- make buttons and chips describe the result of the action.

Acceptance rule:

- each core surface must answer three questions:
  - what is this?;
  - what changed?;
  - what should I do next?

### Phase 3. Polish specialist workflows

Target areas:

- audit packs;
- pilot feedback;
- tenant readiness;
- integrations;
- imports;
- work reports;
- command-center adjacent operator flows.

Acceptance rule:

- specialist pages may keep some domain terms, but the visible language must still be readable by a project/operations manager without product archaeology.

## 3. Concrete execution order

1. Finish the visible Russian-first pass on all core pages.
2. Normalize status labels, badges, and empty states.
3. Convert common action buttons to plain Russian verbs.
4. Review chips, helper text, and microcopy for mixed-language leakage.
5. Keep the sidebar flat and readable, with section headers visible without extra clicks.
6. Tighten the finance / goals / action / documents surfaces so the copy feels operational, not descriptive only.
7. Run build, unit tests, and UI smoke checks after each meaningful batch.

## 4. Definition of done

This phase is done when:

- the core app surfaces read naturally in Russian;
- English remains only where it is the product name, a technical standard, or a connected service name;
- every major page has a clear primary action;
- the portfolio, briefs, meetings, command center, and release surfaces feel like one system;
- the same shared wording works on web, desktop, and iPhone.
- the sidebar stays compact, category-based, and readable without раскрытие скрытых групп;
- the documents hub gives the user a natural place to find app docs, project files, and normative materials;

## 5. Current status

Already improved:

- `/portfolio` executive cockpit;
- `/chat` AI cockpit with left agent rail, quick scenarios, and a simpler command-first layout;
- `/release` distribution hub;
- `/briefs` executive comms;
- `/meetings` action intake;
- `/command-center` exception inbox;
- navigation labels and page titles;
- the sidebar is now flatter and more compact, with the portfolio-health block removed;
- the dashboard top KPI now shows objective coverage instead of a generic portfolio status score;
- the documents hub now shows a Finder-like folder tree, including a dedicated EVM branch for the generator script and dashboard plan;
- key Telegram/email delivery panels and policy flows.

Still to do:

- specialist pages such as audit packs, pilot feedback, tenant readiness, and some internal operator flows;
- full pass on the remaining mixed-language helper text in diagnostics and service-layer labels;
- final mobile readability review after the iPhone package is finished.
