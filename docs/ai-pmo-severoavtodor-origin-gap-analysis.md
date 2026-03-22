# AI-PMO / Severoavtodor Origin Gap Analysis

Updated: 2026-03-20

This document compares the original AI-PMO / Severoavtodor documentation set with the current CEOClaw product.
The goal is not to preserve every old artifact verbatim, but to answer one question clearly:
what did the original program ask for, what did we actually build, and what is still missing before the product is genuinely complete?

## 1. Source map reviewed

I reviewed the following source clusters:

  - Project note: `/Users/aleksandrgrebeshok/Documents/Obsidian Vault/Projects/AI-PMO_Severoavtodor.md`
  - Concept and governance package:
    - `/Users/aleksandrgrebeshok/Desktop/КСУП_AI-PMO_Северавтодор/08_AI_Документация/AI-01_Концепция_системы_AI-PMO.md`
    - `AI-02_Матрица_ответственности.md`
    - `AI-03_Регламент_обучения_AI-PMO.md`
    - `AI-04_Политика_управления_данными_AI-систем.md`
    - `AI-05_Стандарт_качества_AI-рекомендаций.md`
    - `AI-06_Процедура_обновления_и_тестирования_AI-агентов.md`
    - `AI-07_Реестр_ограничений_и_известных_проблем_AI-системы.md`
    - `AI-08_Этический_кодекс_использования_AI.md`
  - Operating procedure package:
    - `РУП-01` through `РУП-18`
    - `ПРО-01` through `ПРО-13`
    - `ИНС-01` through `ИНС-14`
    - `ОТЧ-01` through `ОТЧ-07`
    - `ШАБ-01` through `ШАБ-17`
  - Real-data testing package:
    - `/Users/aleksandrgrebeshok/Desktop/AI_PMO_Real_Data_Testing/`
    - `/Users/aleksandrgrebeshok/Desktop/AI_PMO_Real_Data_Testing/STRUCTURE_MAP.txt`
    - project folders, input packs, output packs, validation reports, and charts
  - Article / whitepaper / presentation package:
    - `/Users/aleksandrgrebeshok/Documents/Obsidian Vault/07_Sources/Docs/Статья AI-PMO.zip`
    - `/Users/aleksandrgrebeshok/Desktop/AI-PMO_Temp/AI_PMO_Whitepaper_Severavtodor_2026_client.docx`
    - `/Users/aleksandrgrebeshok/Desktop/Статья AI-PMO/Старые презентации и статья с ошибкой/AI_PMO_Severoavtodor_Executive_Presentation_2026.pptx`
    - `/Users/aleksandrgrebeshok/Desktop/AI-PMO_Temp/AI_PMO_Cost_Analysis_*.md`
    - `/Users/aleksandrgrebeshok/Desktop/AI-PMO_Temp/AI_PMO_Architecture_Diagrams_2026.md`
    - `/Users/aleksandrgrebeshok/Desktop/AI-PMO_Temp/PROJECT_EXECUTIVE_SUMMARY.md`
    - `/Users/aleksandrgrebeshok/Desktop/AI-PMO_Temp/PROJECT_COST_ANALYSIS.md`
    - `/Users/aleksandrgrebeshok/Desktop/AI-PMO_Temp/FINANCIAL_ANALYSIS_RUSSIA_VS_GLOBAL.md`
  - Current CEOClaw docs and runtime:
    - `README.md`
    - `docs/ceoclaw-launch-master-plan.md`
    - `docs/full-launch-roadmap.md`
    - `docs/release-ready-plan.md`
    - `doc/ceoclaw-agent-platform-plan.md`

Note: several files in `AI-PMO_Temp/` were empty placeholders. The substantive content lives in the backup folders and in the ZIP/docx/pptx sources.

## 2. Executive summary

The short answer is: we did not lose the original idea.

CEOClaw now covers the core AI-PMO operating model better than the original documentation package in several places:

- a visible multi-agent runtime;
- traceable AI runs with proposal/apply semantics;
- projects, tasks, risks, calendar, Gantt, briefs, analytics, and work reports;
- Telegram, GPS/GLONASS, 1C, and evidence-oriented truth layers;
- desktop and iPhone thin shells;
- release page and launch docs.

What is still missing is mostly the last mile of productization, not the original concept itself:

- durable replay across all AI runs and traces;
- one fully canonical runtime path for all AI entry points;
- a productized publishing/export surface for article, presentation, whitepaper, and executive pack outputs;
- a fully proven macOS distribution path;
- a fully proven iPhone distribution path;
- deeper operationalization of training, go/no-go, release, and rollback artifacts.

## 3. What the original AI-PMO was really asking for

The source docs consistently described the system as a "second governance loop" for a project-based enterprise:

1. Collect facts from the field and enterprise systems.
2. Verify those facts against telemetry, evidence, and financial truth.
3. Let specialized agents analyze the situation.
4. Produce recommendations, proposals, and reports.
5. Keep a human in the approval loop.
6. Turn the result into action.

That model appeared in multiple forms:

- `facts -> verification -> agent analysis -> recommendation -> approval -> action`
- "AI recommends, human decides"
- "второй контур управления"
- Orchestrator-Worker architecture

The original package also made a very strong point that the system must be enterprise-grade, not just clever:

- roles and responsibility had to be explicit;
- data governance had to be explicit;
- quality thresholds and known limitations had to be explicit;
- training and change management had to be explicit;
- release, rollback, and go/no-go had to be explicit.

## 4. Coverage matrix

| Layer | What the original docs wanted | CEOClaw today | Assessment |
| --- | --- | --- | --- |
| Governance model | Second governance loop, AI recommends / human decides | AI council runtime, proposal/apply, approvals, traces | Covered |
| Agent model | PMO Director + planning / monitoring / financial / knowledge agents | Canonical runtime, agent registry, council-style execution | Covered, names differ |
| Project control | Projects, tasks, schedules, risks, portfolio control | Projects / tasks / risks / calendar / Gantt / analytics | Covered |
| Evidence layer | Telegram worklog, GPS/GLONASS, Video Fact, fact verification | Telegram, GPS/telemetry, evidence/reconciliation layers | Partial, Video Fact depth still the weakest |
| Financial truth | Budget, EVM, plan-vs-fact, forecast, cost control | Financial truth, EVM, reconciliation, briefs, dashboards | Covered to strong partial |
| Change management | Adoption, champions, training, onboarding, go/no-go | Onboarding, rollout docs, launch docs, release center | Partial, training is more doc-driven than productized |
| Quality and limitations | AI quality KPIs, known issues, override rules, ethics | Fail-closed AI, traces, approval gating, docs for limits | Covered in docs and partly in product |
| Publishing outputs | Whitepaper, executive presentation, article, cost analysis, summary | Briefs, run traces, release notes, launch docs | Partial, no first-class article/presentation studio yet |
| Release operations | DR, rollback, release notes, install flow, go/no-go | Release page, desktop/iPhone shells, runbooks | Partial, distribution still needs hardening |
| Data governance | Data policy, RBAC, audit, retention, sensitive data handling | Live-first auth/security, fail-closed flows, docs | Covered in foundation, still room for more operational surfaces |

## 5. What is already present in CEOClaw

These are the strongest matches to the original AI-PMO intent:

- the AI council / trace / proposal / apply loop;
- a live product core with Prisma-backed data;
- work reports and signal packets that connect facts to action;
- budget, risk, analytics, calendar, Gantt, and project CRUD;
- connectors and truth layers for Telegram, GPS, 1C, and evidence;
- operator-facing reconciliation and escalation surfaces;
- desktop and iPhone shell paths;
- release docs and a public release page.

In practical terms, CEOClaw already contains the modernized form of the original AI-PMO second loop.

## 6. What is still missing or incomplete

### 6.1 Productized document publishing

The old corpus had a much stronger publishing story:

- whitepaper
- executive presentation
- case study
- article
- cost analysis
- finance readiness pack

CEOClaw has briefs and release notes, but it does not yet have a first-class "publishable artifact studio" for these outputs.

This is not a conceptual gap. It is a packaging/productization gap.

### 6.2 Durable replay and a single canonical runtime

The runtime is good, but the final shape still needs to be cleaner:

- every AI entry point should resolve to one canonical runtime path;
- traces should be durable and reopenable;
- memory should be divided cleanly by purpose;
- a run should be explainable after refresh or restart.

This matters because the original docs cared about trust and auditability just as much as recommendations.

### 6.3 Video Fact depth

The source docs treated Video Fact as a real evidence layer, not just a tag or hint.
CEOClaw already carries the concept, but the deepest video-verified workflow still needs more product surface if we want to match the original ambition end to end.

### 6.4 Training and change management

The original docs had a formal adoption package:

- role-based training;
- certification and attestation;
- champions and internal rollout;
- change management metrics.

CEOClaw has onboarding and launch docs, but this is still more operational documentation than productized enablement.

### 6.5 Release packaging

The desktop and iPhone shells exist, which is good.
The remaining work is making the distribution paths boring and repeatable:

- clean Mac install;
- signed/notarized desktop artifact;
- TestFlight/App Store-ready iPhone path;
- release page wired to the real artifacts.

## 7. Assessment

My assessment is:

- Conceptual parity with the original AI-PMO program: high.
- Enterprise workflow coverage: high.
- Release completeness: medium-high, but not final.
- Missing ideas: few.
- Missing productization: still material.

The important conclusion is that we did **not** forget the original enterprise vision.
We mostly translated it into a more modern product shape:

- less paper, more runtime;
- less diagram-only architecture, more live traces and flows;
- less theory, more actual surfaces and install paths.

## 8. What I would prioritize next

1. Finish durable AI run replay and make the runtime canonical everywhere.
2. Decide whether article / presentation / whitepaper output should become a first-class product feature or remain a documented back-office workflow.
3. Harden the macOS and iPhone packaging paths until a clean machine can install them without handholding.
4. Deepen the Video Fact and reconciliation loop if the business wants full evidence-driven project control.
5. Add a lightweight training / certification surface only if adoption becomes the bottleneck.

## 9. Bottom line

The original AI-PMO design was broad, and a lot of the important substance survived.
CEOClaw now implements most of the core enterprise behavior and does so with a better live runtime than the old docs described.

What remains is not "we forgot the original idea".
What remains is:

- polish the runtime;
- productize the outputs;
- finish distribution;
- and make the launch path boringly reliable.
