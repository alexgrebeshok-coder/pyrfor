# Pyrfor Ecosystem — Strategic Development Plan

**Date:** 2026-05-15
**Status:** Strategy v1.2 — production-readiness refinement of PYRFOR-ECOSYSTEM-VISION.md
**Depends on:** PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md, PYRFOR-SELF-IMPROVEMENT-ARCHITECTURE.md

---

## 0. Executive Summary

Pyrfor Ecosystem Vision defines the **what** — a three-layer AI operating system with modular blocks. This document defines the **how** — competitive landscape analysis, gap identification, standards alignment, and a strategic roadmap to make Pyrfor the definitive platform for governed industrial AI workflows.

**Council refinement:** the strongest differentiator is not "offline-first" alone. Offline/local AI is becoming table stakes. Pyrfor's defensible space is:

> **An open, air-gapped-capable, governed AI workbench for regulated construction workflows — with typed industrial blocks, audit-ready execution, project memory, and local/on-prem deployment.**

The beachhead should be narrower than "AI OS for everything": **Docs/1C + КС-2/КС-3 + estimate reconciliation**. This workflow creates immediate value before the public marketplace exists.

---

## 1. Competitive Landscape — Who Else is Building an AI OS?

### 1.1 Direct / Adjacent Competitors

| Platform | Approach | Pyrfor Advantage |
|----------|----------|-----------------|
| **Microsoft Agent Framework** | Production agent framework: workflows, checkpointing, human-in-loop, OTel, Foundry/Azure path | Strong enterprise threat, but not TypeScript-first, not local-first by default, and not focused on construction blocks or governed postmortem memory. |
| **LangGraph / CrewAI / OpenAI Agents SDK** | Multi-agent orchestration frameworks | Strong orchestration, weak domain packaging. Pyrfor should interoperate rather than compete directly. |
| **Cline / OpenHands / Aider** | Coding agents and developer workbenches | Threat for developer workflow. Pyrfor's moat is governed execution + industrial blocks, not just IDE automation. |
| **Cognotik** | Open-source, local-first desktop AI OS with apps/plugins | Closest desktop positioning. Pyrfor must differentiate through governed lifecycle, audit trail, industrial contracts, BIM/1C workflows. |
| **LocalAI / Ollama / Open WebUI** | Local/offline inference and AI UI platforms | Useful substrate, not full governed industrial OS. Pyrfor should support them as backends. |

### 1.2 Construction/Domain Competitors

| Platform | Domain | Pyrfor Advantage |
|----------|--------|-----------------|
| **BIMWorkplace** | IFC-native BIM/CDE SaaS with AI-assisted model workflows | Domain-specific, but not an agent OS; no open offline governed execution. |
| **IfcOpenShell / Bonsai** | Open-source IFC, BCF, 4D/5D BIM libraries | Library foundation, not a governed workbench. Pyrfor should use it rather than compete with it. |
| **Procore / Kahua / Autodesk ACC AI** | Construction management SaaS AI | Cloud/SaaS and vendor-locked. Pyrfor: local/on-prem, Russian standards, 1C, auditable execution. |
| **1C integrators / Excel macros** | Practical incumbent in Russian construction | Cheaper and familiar. Pyrfor must win by reducing manual reconciliation time and preserving audit evidence. |

### 1.3 Key Insight

**Safe claim:** no verified agent OS combines all four pillars:
1. open-source / open-core distribution;
2. air-gapped or offline-capable operation;
3. governed execution lifecycle with permissions, audit, postmortem, and project memory;
4. packaged industrial blocks for construction, estimates, BIM/CDE, 1C, and regulatory checks.

**Risky claims:** "offline-first" and "open-source AI OS" alone are no longer enough. Cognotik, LocalAI, Open WebUI, and coding agents already occupy parts of that space. Pyrfor must lead with **governed regulated workflows**.

Pyrfor's sharper positioning:

> **The governed local AI workbench for construction documents, estimates, BIM evidence, 1C reconciliation, and regulatory review.**

---

## 2. Pyrfor Architecture — Standards Alignment

### 2.1 Protocol Standards

| Standard | Pyrfor Status | Gap |
|----------|--------------|-----|
| **MCP** (Streamable HTTP, 2025-03-26) | ✅ stdio + SSE; Streamable HTTP planned P0-5 | Implement Streamable HTTP transport |
| **A2A** (Google / Linux Foundation) | ✅ Core implementation | Publish A2A Agent Cards for every block and skill |
| **ACP (IDE / Zed-style)** | ✅ Bridge exists | Production hardening |
| **ACP Trajectory Metadata (IBM BeeAI-style)** | 🔜 Proposed | Reuse trajectory metadata for postmortems and audit ledger |
| **AG-UI** (CopilotKit, 2025) | 🔜 P1-1 | Streaming frontend protocol |
| **OpenTelemetry GenAI** | 🔜 P0-4 | Emit lifecycle spans for plan/research/execute/critique/postmortem/memory |
| **OpenAPI 3.1 / JSON Schema / Zod** | 🔜 Proposed | Contract registry for block inputs/outputs |
| **IFC / BCF / bSDD APIs** | 🔜 Proposed | BIM/CDE integration substrate |

### 2.2 Industrial Standards (Russian Federation)

| Standard | Domain | Integration |
|----------|--------|-------------|
| **ГОСТ Р 21.1101-2013** | СПДС (проектная документация) | Docs Block — validate docs |
| **ГОСТ Р 7.0.97-2016** | Документооборот | Docs Block — format compliance |
| **СНиП / СП** | Строительные нормы | Regulatory Block — auto-check |
| **МДС 81-35.2004** | Сметное дело | Estimate Block — methodology |
| **КС-2, КС-3, КС-6, КС-11** | Унифицированные формы | Docs Block — auto-fill |
| **ФЗ-44 / ФЗ-223** | Госзакупки | Tender Block — compliance |
| **ISO 19650** | BIM (информационное моделирование) | Future: BIM Block adapter |
| **IFC4x3 Add2** | BIM model exchange | BIM/CDE Block — model objects and quantities |
| **BCF** | BIM issue exchange | Quality Block — issues, clashes, remarks |
| **bSDD** | buildingSMART data dictionary | Regulatory Block — classifications and properties |
| **Foundation CDE API** | Common Data Environment | CDE connector; use instead of archived OpenCDE references |

### 2.2.1 Russian Regulatory Scope

Pyrfor's first industrial market is Russia, so "audit-ready" must be scoped precisely. Community v1 provides technical auditability, not legal ЭДО or certified КИИ deployment.

| Regulation / Area | Requirement | v1.2 Scope | Plan |
|-------------------|-------------|------------|------|
| **152-ФЗ** | Personal data locality, access audit, erasure | Technical controls only | `RU-COMPLIANCE-SCOPE.md`: PDM + DRG; operator duties remain with customer |
| **187-ФЗ КИИ** | Categorization, certified controls, incident process | Community v1 is not for direct КИИ category 1/2 processing | Pro CPD profile: Astra Linux / Postgres Pro / hardening docs |
| **63-ФЗ КЭП** | Legally significant signature, TSP, CAdES | Out of Community v1 | Pro GSM module via CryptoPro PKCS#11 |
| **ГОСТ Р 34.10/34.11** | ГОСТ signature/hash for КЭП | Out of Community v1 | GSM wraps certified provider; Pyrfor does not implement its own СКЗИ |
| **Реестр ПО Минцифры** | Required for many B2G procurement paths | Not yet included | RP package: SBOM, IP/legal entity/support docs |
| **Data residency for LLM** | No foreign provider egress for PII/KII/commercial secret | In scope | DRG blocks cloud LLM calls by data class and deployment policy |
| **ФЕР/ТЕР/ГЭСН/ФСНБ** | Normative estimate data licensing | BYOD only | Phase B: FGIS CS API research; redistribution only after agreements |

See `docs/specs/RU-COMPLIANCE-SCOPE.md` for the detailed engineering scope and legal disclaimers.

### 2.3 Engineering Standards

| Standard | Pyrfor Alignment |
|----------|-----------------|
| **Semantic Versioning** | Engine: semver. Blocks: semver with compatibility matrix. |
| **Conventional Commits** | All repos. Enforced by CI. |
| **OpenAPI 3.1** | Gateway API fully documented. Auto-generated from code. |
| **TypeScript strict mode** | All engine code. Generics everywhere. |
| **GPG-signed releases** | ✅ v0.3.0. Ed25519 for Tauri updater. |
| **SBOM** | 🔜 P2-8. CycloneDX via cargo-sbom. |

---

## 3. Gap Analysis — What's Missing

### 3.1 Block SDK (CRITICAL — not yet defined)

**Current state:** Blocks are a concept. No formal SDK for creating them.

**Decision v1.2:** `block.json` is the single canonical Block SDK contract. The old imperative `BlockDefinition` TypeScript interface is deprecated and must not be used for new blocks.

**Canonical artifact:** `docs/specs/BLOCK-MANIFEST-V1.md`

The Block Manifest defines:
- block identity, runtime mode, and Engine compatibility;
- explicit capability tokens with human-readable reasons;
- Contract Registry inputs/outputs;
- UI panels, events, memory scopes, and artifact types;
- lifecycle hooks as named package scripts, not embedded callbacks;
- `optimizer_policy` with `editable`, `editable_fields`, `never_editable`, and `requires_human_approval`;
- signing and certification states (`dev`, `internal`, `pilot`, `certified`, `revoked`).

**Gap:** No runtime loader/validator exists yet. Blocks are hand-wired, not pluggable. Phase A must implement the loader and migrate existing Coding/CEOClaw blocks to Manifest v1.

### 3.2 Block Composition Protocol

**Current state:** Blocks don't formally communicate. Only through Engine memory.

**What's needed:**
- **Block Contract** — typed interfaces between blocks
- **Event Protocol** — block A emits "estimate_completed", block B subscribes
- **Data Contract** — Estimate Block outputs `CostBreakdown`, Budget Block consumes it

### 3.3 Memory Scoping

**Current state:** All memory in one SQLite. No block-level isolation.

**What's needed:**
```sql
-- Per-block memory namespaces
CREATE TABLE block_memory (
  block_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (block_id, namespace, key)
);
```

### 3.4 UI Composition

**Current state:** IDE panels are hardcoded (ChatPanel, FileTree, Terminal).

**What's needed:** 
- **Panel Registry** — blocks register panels dynamically
- **Slot System** — IDE has slots (left, center, right, bottom), blocks claim slots
- **Panel API** — `registerPanel(blockId, panelDef)` → appears in IDE

### 3.5 Block Marketplace

**Current state:** Skills marketplace foundation exists (import → test → approve). No block marketplace.

**What's needed:**
- Block publishing flow (validate → quarantine → test → approve → marketplace)
- Block search/install (`pyrfor marketplace install estimate-block`)
- Version management (install specific version, upgrade, downgrade)
- Dependency resolution (block A requires block B v1.2+)

### 3.6 Industrial Block Templates

**Current state:** Concept only. No templates exist.

**What's needed per block:**
- System prompt tuned for domain
- Custom tools (e.g., estimate calculator, GOST validator)
- Domain memory schema
- UI panel for domain-specific visualization
- Test suite with domain examples

### 3.7 Team/Enterprise Features

**Current state:** Single-user, local-first.

**Gaps:**
- Shared memory sync (team members see same project state)
- Role-based access (project manager vs estimator vs quality inspector)
- Audit log for team actions
- Block deployment to team members

### 3.8 Block Runtime Contract

**Current state:** Block SDK is now specified as `block.json`, but the runtime boundary is not implemented yet.

**What's needed:**
- **Block Package** — signed artifact with manifest, code, UI, schemas, tests, SBOM.
- **Block Manifest v1** — declarative permissions, contracts, events, panels, migrations, runtime mode, and `optimizer_policy`.
- **Sandbox Profile** — `trusted-core`, `local-worker`, `wasm`, `container`, `remote`.
- **Capability Tokens** — short-lived grants for fs/network/secrets/model/tool access.
- **Certification Profile** — required tests for "Pyrfor Governed Block" approval.

### 3.9 Contract Registry + Artifact Ledger

**Current state:** Blocks can conceptually pass data, but there is no canonical lineage of outputs.

**What's needed:**
- **Contract Registry** with versioned schemas: `Document@1`, `EstimateItem@1`, `RegulatoryFinding@1`, `BIMObject@1`, `ApprovalEvidence@1`.
- **Event Envelope** with `schema_version`, `correlation_id`, `causation_id`, `idempotency_key`.
- **Artifact Ledger** that records every generated artifact: input refs, model, prompt version, tools, block version, reviewer, approval status.
- **Reproducibility mode** for regulated workflows: frozen model, prompt, data pack, and block versions.

### 3.10 Policy-as-Code Governance

**Current state:** Trust Panel and approvals exist, but policies are not yet first-class.

**What's needed:**
- Rules like: "Regulatory Block cannot mark compliance as final without human approver."
- Per-block budget, model, network, and memory policies.
- RBAC roles: `viewer`, `engineer`, `estimator`, `pto`, `project_manager`, `admin`, `auditor`.
- Approval delegation and revocation.

### 3.11 Local Inference Backends

**Current state:** Offline-first is claimed, but backend strategy is not explicit.

**What's needed:**
- **Ollama** as simple developer/local model backend.
- **LocalAI** as enterprise air-gapped backend with API keys, RBAC, quotas, multiple backends.
- **llama.cpp/GGUF** approved model packs for regulated deployments.
- Model registry metadata: license, quantization, hardware profile, benchmark, allowed data classes.

### 3.12 Industrial Ontology

**Current state:** Blocks are listed, but the shared industrial data model is missing.

**What's needed:**

`Project → Contract → WBS/CBS → Document → BIMObject → EstimateItem → ScheduleActivity → SupplyItem → InspectionRecord → ChangeOrder → PaymentCertificate`

Every domain entity should carry:
- `source_ref`
- `version`
- `author`
- `timestamp`
- `evidence_uri`
- `confidence`
- `approval_status`
- `approver_id`
- `lineage_artifact_id`

### 3.13 MVP Adoption Wedge

**Current state:** Roadmap starts with platform primitives and broad block ecosystem.

**Council recommendation:** start with one paid, daily, painful workflow:

> **Docs/1C + КС-2/КС-3 + estimate reconciliation assistant.**

This proves value before marketplace complexity. It avoids the legal risk of "AI-generated estimates" by positioning Pyrfor as a **checking and reconciliation copilot** with human approval.

### 3.14 Summary Gap Matrix

| # | Gap | Priority | Complexity | Phase |
|---|-----|----------|------------|-------|
| G1 | Block Runtime Contract / Manifest v1 | P0 | L | Foundation |
| G2 | Memory Scoping + ACL | P0 | M | Foundation |
| G3 | Contract Registry | P0 | M | Foundation |
| G4 | Artifact Ledger / Lineage | P0 | M | Foundation |
| G5 | Docs/1C + КС reconciliation MVP | P0 | M | Beachhead |
| G6 | Policy-as-Code Governance | P1 | M | Foundation |
| G7 | UI Panel Registry | P1 | M | Desktop |
| G8 | Block Composition DAG + Event Bus | P1 | M | Foundation |
| G9 | Industrial Ontology | P1 | M | Domain |
| G10 | LocalAI/Ollama/GGUF backend profiles | P1 | M | Offline |
| G11 | Block Marketplace | P2 | L | Ecosystem |
| G12 | Industrial Templates | P2 | L | Domain |
| G13 | Team Features | P3 | XL | Enterprise |
| G14 | Streamable HTTP (MCP) | P0 | M | Already P0-5 |
| G15 | AG-UI Protocol | P1 | M | Already P1-1 |
| G16 | OTel GenAI | P0 | M | Already P0-4 |

---

## 4. Strategic Roadmap

### Phase 0.0: Beachhead Walking Skeleton — prove the workflow shape

```
Workflow: Docs/1C + КС-2/КС-3 + estimate reconciliation
  └─ Import 1C OData / Excel / PDF documents
  └─ Extract line items, counterparties, objects, sums, dates
  └─ Match against estimate/contract/previous acts
  └─ Highlight discrepancies and missing evidence
  └─ Generate approval report with artifact lineage
  └─ Human approves/rejects in Trust Panel
```

Phase 0.0 deliberately uses **proto-lineage**, not the full Artifact Ledger, to avoid pretending Phase 0 can ship before Phase A primitives exist.

Acceptance is defined in `docs/specs/MVP-RECONCILIATION-ACCEPTANCE.md`:
- fixture package with anonymized КС-2, КС-3, contract extract, and 1C OData snapshots;
- 5 known discrepancies with expected findings;
- precision >= 0.80, recall >= 0.80, false positives <= 20%;
- 100% findings link to source evidence;
- latency <= 10 minutes on Apple M1 / 16 GB;
- zero external network calls in air-gapped mode;
- no final report without human review.

### Phase A: Block Runtime Foundation

```
Phase A.0: Legacy Block Migration
  └─ Coding Block → Manifest v1
  └─ CEOClaw Block → Manifest v1
  └─ Feature-flagged rollback to legacy wiring

G1: Block Runtime Contract
  └─ Block Manifest v1
  └─ BlockLoader from ~/.pyrfor/blocks/
  └─ Lifecycle: install → verify → migrate → activate → run → suspend → upgrade → rollback → revoke → uninstall
  └─ CLI: pyrfor block init, validate, test, dev, pack

G2/G3/G4: Safety primitives
  └─ Memory scopes + ACL
  └─ Contract Registry
  └─ Artifact Ledger
  └─ Capability tokens
  └─ OTel GenAI spans per lifecycle stage
```

### Phase 0.1: Beachhead MVP — full lineage

After Phase A primitives exist, Phase 0.1 upgrades the same reconciliation workflow from proto-lineage to the real Artifact Ledger and Contract Registry. This is the first "pilot-ready" version.

### Phase B: Internal Industrial Blocks

```
Dogfood before public marketplace
  └─ Docs/1C Block
  └─ Estimate Reconciliation Block
  └─ Regulatory Evidence Block
  └─ BIM/CDE Block skeleton using IfcOpenShell/IFC/BCF

G8: Block Composition
  └─ Typed contracts between blocks
  └─ Typed event bus
  └─ Workflow DAG
  └─ Data schemas for Document, EstimateItem, RegulatoryFinding, BIMObject, ApprovalEvidence
```

### Phase C: Protocol + Offline Completion

```
P0-5: MCP Streamable HTTP
P0-4: OpenTelemetry GenAI
P1-1: AG-UI Protocol
P1-3: ACP server → Zed/JetBrains
P1-x: A2A Agent Cards for blocks
P1-x: LocalAI/Ollama/GGUF model profiles
P1-x: IfcOpenShell BIM skill adapter
```

### Phase D: Governed Marketplace + Enterprise

```
G11: Block Marketplace
  └─ Signed packages
  └─ SBOM + provenance
  └─ Quarantine/test/approve
  └─ Trust tiers and revocation

G13: Team Features
  └─ Shared memory sync
  └─ RBAC
  └─ Team audit log
  └─ Block deployment to team
```

---

## 5. Block Template Specification

### 5.0 Shared Industrial Data Contracts

Every industrial block should speak the same typed language:

| Contract | Producer | Consumer |
|----------|----------|----------|
| `Document@1` | Docs/1C Block | Regulatory, Estimate, Tender |
| `EstimateItem@1` | Estimate Block | Budget, Docs, Project Controls |
| `RegulatoryFinding@1` | Regulatory Block | Docs, Quality, Approval |
| `BIMObject@1` | BIM/CDE Block | Estimate, Schedule, Quality |
| `SupplyItem@1` | Supply Chain Block | Schedule, Budget |
| `ScheduleActivity@1` | Schedule Block | Project Controls, CEOClaw |
| `ApprovalEvidence@1` | Trust Panel / any block | Audit, Reports |

The rule: **no block passes untyped JSON to another block**. All cross-block outputs must be contract-validated and stored in the Artifact Ledger.

### 5.1 Estimate Block (Сметный блок)

**Purpose:** Создание и проверка сметной документации.

**Tools:**
- `calculate_volume(dimensions, material)` → quantity
- `lookup_rate(code_TER)` → unit cost
- `apply_coefficient(base_cost, conditions)` → adjusted cost
- `generate_ks2(sections)` → КС-2 form
- `validate_against_mds(estimate)` → compliance report
- `reconcile_ks_with_estimate(ks_doc, estimate_ref)` → discrepancy report
- `link_bim_quantities(ifc_selection)` → BIM-backed quantities

**Skills:**
- `estimate-calculator` — методика расчёта по МДС 81-35.2004
- `fer/ter/gesn-database` — **bring-your-own data pack in v1.0**. Pyrfor ships parsers/importers, not normative databases. Phase B researches ФГИС ЦС API. Bundled redistribution requires explicit licensing agreements.
- `ifc5d-quantity-linker` — cost/quantity extraction via IfcOpenShell where applicable

**Memory Tables:**
```sql
CREATE TABLE estimate_items (
  id TEXT PRIMARY KEY,
  estimate_id TEXT,
  code TEXT,           -- шифр расценки
  name TEXT,           -- наименование работы
  unit TEXT,           -- единица измерения
  quantity REAL,       -- объём
  unit_cost REAL,      -- стоимость единицы
  total_cost REAL,     -- общая стоимость
  labor_cost REAL,     -- зарплата рабочих
  machine_cost REAL,   -- стоимость машин
  material_cost REAL,  -- стоимость материалов
  overhead REAL,       -- накладные расходы
  profit REAL,         -- сметная прибыль
  source_ref TEXT,     -- документ/модель/строка источника
  artifact_id TEXT,    -- lineage artifact
  approval_status TEXT -- draft / reviewed / approved / rejected
);
```

**UI Panel:** Spreadsheet-like view with columns for code, name, unit, quantity, cost per unit, total. Export to Excel, 1C.

### 5.2 Regulatory Block (Нормативный блок)

**Purpose:** Проверка проектной документации на соответствие ГОСТ/СНиП/СП.

**Tools:**
- `check_gost(document, standard_code)` → compliance report
- `find_applicable_standards(project_type)` → list of relevant standards
- `compare_versions(old_doc, new_doc)` → diff with regulatory implications

**Skills:**
- `gost-validator` — знание структуры ГОСТ Р 21.1101
- `snip-checker` — проверка строительных норм

**Memory Tables:**
```sql
CREATE TABLE regulatory_checks (
  id TEXT PRIMARY KEY,
  document_ref TEXT,
  standard_code TEXT,   -- ГОСТ Р 21.1101-2013
  clause TEXT,          -- пункт стандарта
  status TEXT,          -- compliant / non_compliant / not_applicable
  finding TEXT,         -- что не так
  recommendation TEXT   -- как исправить
);
```

### 5.3 Docs Block (Документационный блок)

**Purpose:** Интеграция с 1С, обработка входящих документов, генерация отчётов.

**Tools:**
- `import_1c_document(odata_url, doc_ref)` → structured data
- `extract_attachments(doc_ref)` → file list
- `parse_pdf_to_markdown(path)` → text
- `fill_template(template, data)` → populated document
- `extract_line_items(document_ref)` → structured items
- `match_counterparty(document_ref, registry)` → normalized counterparty
- `generate_reconciliation_report(findings)` → human review pack

**Skills:**
- `1c-odata-connector` — работа с OData 1С (Базис-Тюмень)
- `document-parser` — MarkItDown-based parsing

**UI Panel:** Document list with search, attachment preview, 1C import wizard.

### 5.4 BIM/CDE Block

**Purpose:** IFC/BCF/CDE integration for model-backed quantities, issues, revisions, and evidence.

**Tools:**
- `import_ifc(path)` → BIM model index
- `select_bim_objects(query)` → `BIMObject[]`
- `extract_quantities(objects)` → quantities with model lineage
- `import_bcf_issues(path_or_api)` → issue list
- `validate_ids(model, ids_spec)` → model information requirements report
- `sync_cde_package(cde_ref)` → document/model revision set

**Skills:**
- `ifcopenshell-adapter` — IFC4x3, ifc4d/ifc5d, BCF, bSDD
- `iso-19650-cde-checker` — naming, revision, suitability, status checks

### 5.5 Project Controls Block

**Purpose:** Schedule + cost + progress control across estimates, supplies, and acts.

**Tools:**
- `import_schedule(file_or_api)` → activities
- `link_cost_codes(estimate_items, schedule)` → WBS/CBS mapping
- `calculate_evm(project_state)` → PV/EV/AC, CPI/SPI, EAC
- `detect_delay_risks(schedule, supply_items, ks_progress)` → risk report

**UI Panel:** Gantt + EVM dashboard + "what changed this week" report.

---

## 6. How This Connects to Existing Work

### 6.1 Relationship to P0-P3 Plan

| Existing Task | Ecosystem Impact |
|---------------|-----------------|
| P0-1 (Public GitHub) | Required for Marketplace visibility |
| P0-2 (One-command install) | Required for Block SDK adoption |
| P0-3 (Sandbox) | Blocks execute in sandbox |
| P0-9 (Permissions) | Per-block permission grants |
| P0-10 (Cost guardrails) | Per-block budget scoping |
| P1-1 (AG-UI) | Blocks stream to frontend |
| P1-7 (Plugin/Skills) | Blocks extend via skills |
| P2-1 (Self-Improvement) | Blocks improve over time |

### 6.2 Relationship to SI1-SI8

Self-Improvement OS already built. Industrial blocks benefit automatically:
- Estimate Block learns from past estimates (Experience Library)
- Pattern Miner finds optimal calculation strategies
- Optimizer suggests better coefficient choices

---

## 7. Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Single-author bottleneck | High | Roadmap becomes wishlist | Cut to Phase 0.0 + Phase A core; defer Phase D until funding/contributors |
| Block SDK too complex | Medium | Blocks don't get built | Start with 1 template, iterate |
| Industrial standards change | Low | Regulatory Block outdated | Standards as versioned skills |
| Team adoption slow | Medium | Solo-only Pyrfor | Focus on individual value first |
| Competitor builds faster | Medium | Lose first-mover advantage | Open-source + governed = moat |
| Over-engineering | High | Never ship | Each phase delivers value independently |
| Offline-first becomes commodity | High | Positioning weakens | Reframe as air-gapped, zero-telemetry, audit-ready workflows |
| Hallucinated regulatory conclusions | High | Legal/compliance risk | Clause-level retrieval, evidence links, mandatory human approval |
| КЭП missing but "audit-ready" overclaimed | High | Customer legal misunderstanding | State Ledger = technical audit trail; GSM/КЭП is Pro/out of v1 |
| KII scope confusion | Medium | Unsafe regulated deployment | Community v1 not for КИИ cat. 1/2; CPD Pro path |
| Licensed estimate/norm databases unavailable | High | Estimate Block incomplete | BYOD data packs in v1; FGIS CS API research; no redistribution without license |
| SI telemetry conflicts with air-gapped promise | Medium | Trust loss | Local OTel collector and local Pattern Miner; zero egress by default |
| Marketplace supply-chain attack | Medium | Trust loss | Signed packages, SBOM, provenance, quarantine, revocation |
| Memory leakage between blocks/projects | Medium | Confidentiality breach | Scope + ACL + capability tokens + audit ledger |

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Phase 0.0 precision | >= 0.80 on fixture package |
| Phase 0.0 recall | >= 0.80 on fixture package |
| False positives | <= 20% of produced findings |
| Evidence coverage | 100% findings have source file hash + location |
| End-to-end processing time | <= 10 minutes per package on Apple M1 / 16 GB |
| Air-gapped network egress | 0 calls outside localhost/on-prem allowlist |
| Human review completion | 100% findings accepted/rejected/deferred/escalated before final export |
| Pilot manual review reduction | Phase 0.1 reduces review time by >= 30% versus measured baseline |
| Weekly active projects | Measures real operational use, not just installs |
| Block certification pass rate | Measures ecosystem quality before public marketplace scale |
| GOST/СП clause coverage | Coverage tracked by versioned regulatory pack, not vague "knowledge" |

---

## 9. Immediate Next Actions

1. **Define Block Manifest v1 + Runtime Contract** — permissions, contracts, events, panels, migrations, sandbox, certification.
2. **Ship Phase 0.0 walking skeleton** — fixture package, proto-lineage, human review, air-gapped demo.
3. **Migrate Coding + CEOClaw to Manifest v1** — feature-flagged rollback.
4. **Build Artifact Ledger + Contract Registry** — make every industrial result traceable and typed.
5. **Upgrade to Phase 0.1 full-lineage MVP** — the first pilot-ready industrial wedge.
6. **Add Memory Scoping + ACL + Capability Tokens** — prevent cross-block/project leakage.
7. **Create industrial contracts** — `Document@1`, `EstimateItem@1`, `RegulatoryFinding@1`, `BIMObject@1`, `ApprovalEvidence@1`.
8. **Prepare offline backend profiles** — Ollama for simple local, LocalAI for enterprise air-gapped, GGUF approved models.
9. **Dogfood 3 internal blocks** — Docs/1C, Estimate Reconciliation, Regulatory Evidence before public marketplace.

---

## 10. Business Model

**Decision v1.2:** Pyrfor should use **open-source core + commercial enterprise services/blocks**, not a pure hobby/personal-tool model.

| Layer | Model |
|-------|-------|
| Engine, Desktop, CLI, Block Manifest, basic local providers | Open-source core |
| Internal industrial blocks in early phase | Open-source/dogfood where possible |
| Pro compliance modules (GSM, CPD, RP), enterprise deployment profiles, regulated customer support | Commercial |
| Customer integrations (1C variants, CDE, data migration, custom regulatory packs) | Paid implementation/services |
| Public Marketplace | Deferred until demand is proven |

The first revenue hypothesis is not "marketplace commission". It is paid implementation/support for a concrete reconciliation workflow in a construction organization.

---

## 11. Go-to-Market and First Pilot

The first pilot should be internal and concrete, not abstract "3-5 customers".

| Stage | Target | Success condition |
|-------|--------|-------------------|
| Pilot 0 | Author's own construction context (CHMK / Базис-Тюмень-style workflow) | One anonymized package can be checked with Phase 0.0 demo script |
| Pilot 1 | One friendly estimator/PTO user | Manual baseline measured; >= 30% time reduction in Phase 0.1 |
| Pilot 2 | One small project team | Repeat weekly use on the same object/contract |
| Paid pilot | Construction firm with 1C + KS pain | Paid support/integration agreement, not broad platform sale |

Buyer/user hypothesis:
- first user: сметчик / ПТО / финансовый контролёр;
- economic buyer: project director / CFO / construction company owner;
- wedge: "find discrepancies before signing", not "AI generates legally final estimates".

---

## 12. Multi-Agent Council Synthesis

This strategy was refined through two council rounds. v1.1 clarified market/architecture/domain/product positioning; v1.2 red-teamed production readiness and Russian compliance.

| Agent | Main Decision |
|-------|---------------|
| Market research | Keep the uniqueness claim, but make it precise: governed + air-gapped + industrial blocks is the moat; offline/open-source alone is not enough. |
| Architecture | Build Block Runtime Contract, Contract Registry, Artifact Ledger, capability tokens, and certification before public marketplace. |
| Industrial domain | Add BIM/CDE, Project Controls, Field QA/QC, Regulatory Evidence, and one shared industrial ontology. |
| Product strategy | Use Docs/1C + КС reconciliation as the adoption wedge; delay broad marketplace and universal AI OS messaging until pilots prove value. |
| Devil's advocate | Fix SDK contradictions, Phase 0/A ordering, legal scope, acceptance metrics, and solo-author risk before calling the strategy shippable. |
| RU compliance | Add DRG, GSM, PDM, CPD, RP; explicitly distinguish technical audit trail from legally significant ЭДО. |

### External Watchlist

- **Cline / OpenHands / Aider** — coding agents may become generic AI workbenches.
- **Microsoft Agent Framework / LangGraph / CrewAI** — orchestration ecosystems to interoperate with, not necessarily replace.
- **Cognotik / Open WebUI / LocalAI** — local AI platforms that weaken generic offline-first positioning.
- **IfcOpenShell / buildingSMART IFC4x3 / BCF / bSDD / Foundation CDE** — open BIM stack Pyrfor should build on.
- **Procore / Kahua / Autodesk ACC / BIMWorkplace** — commercial AEC platforms; strong in SaaS, weaker in open governed local execution.

### What Not to Build Yet

- Public block marketplace before internal block certification works.
- Full tender/schedule/supply-chain suite before the first reconciliation workflow is adopted.
- A universal AI OS narrative for all industries before construction pilots create proof.
- Automatic final regulatory/legal conclusions without human approval and evidence trail.
- Legally significant КЭП/ЭДО claims in Community v1.
- Redistribution of ФЕР/ТЕР/ГЭСН/ФСНБ data without explicit license.

---

*This document refines PYRFOR-ECOSYSTEM-VISION.md into an actionable strategic plan with concrete gaps, standards, specifications, legal scope, acceptance criteria, and first-pilot path.*

**Author:** Клод Гребешок 🐾 | 2026-05-15
