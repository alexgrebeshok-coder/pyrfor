# Pyrfor Ecosystem — Strategic Development Plan

**Date:** 2026-05-15
**Status:** Strategy v1.0 — complement to PYRFOR-ECOSYSTEM-VISION.md
**Depends on:** PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md, PYRFOR-SELF-IMPROVEMENT-ARCHITECTURE.md

---

## 0. Executive Summary

Pyrfor Ecosystem Vision defines the **what** — a three-layer AI operating system with modular blocks. This document defines the **how** — competitive landscape analysis, gap identification, standards alignment, and a strategic roadmap to make Pyrfor the definitive platform for industrial AI workflows.

**Core insight:** No existing platform combines governed AI execution + industrial domain blocks + native desktop + offline-first architecture. This is Pyrfor's unique space.

---

## 1. Competitive Landscape — Who Else is Building an AI OS?

### 1.1 Direct Competitors (Block-Based AI Platforms)

| Platform | Approach | Pyrfor Advantage |
|----------|----------|-----------------|
| **Sema Code** (Apr 2026) | Decoupled agent engine as npm lib; multi-tenant; embeddable | Pyrfor: governed lifecycle, NOT just embedding. Pyrfor adds: sandbox, memory, self-improvement. Sema is engine-only — no desktop, no marketplace, no industrial blocks. |
| **Matrix OS** | Agent-native OS with whitepaper | Closed-source, cloud-only. Pyrfor: open-source, offline-first, native desktop. |
| **Cognotik** | Cognitive OS for developers | Developer-only focus. Pyrfor: developer + industrial. Construction, logistics, regulatory blocks. |
| **Namzu** | "Agent kernel for everyone" | Early stage. Pyrfor: production (5900+ tests, v0.3.0 released). |
| **Opulent OS 2.0** | Agent-native orchestration platform | Enterprise/cloud focus. Pyrfor: local-first, governed, TypeScript. |

### 1.2 Construction/Domain Competitors

| Platform | Domain | Pyrfor Advantage |
|----------|--------|-----------------|
| **Pelles/TACO** | A2A construction standard, BIM agents | Agent-framework only. Pyrfor: full platform (engine + desktop + marketplace). Can integrate TACO as a protocol adapter. |
| **BIMWorkplace** | AI for BIM projects | BIM-specific, vendor-locked. Pyrfor: multi-domain, open protocols. |
| **Syntes AI** | Construction/engineering AI | Proprietary cloud. Pyrfor: open-source, offline. |
| **Kahua Noa / Procore Copilot** | Construction management AI | SaaS only, US-market. Pyrfor: local, Russian standards (ГОСТ/СНиП/СП). |

### 1.3 Key Insight

**No one is building an open-source, offline-first, governed AI OS with industrial blocks.** Everyone either:
- Builds coding-only agents (Aider, Cline, Codex)
- Builds cloud platforms (Matrix OS, Opulent)
- Builds single-domain tools (BIM workbench, Procore)

Pyrfor's positioning: **the only open-source AI OS that goes from code generation to construction estimate to regulatory check — in one governed platform, on your laptop.**

---

## 2. Pyrfor Architecture — Standards Alignment

### 2.1 Protocol Standards

| Standard | Pyrfor Status | Gap |
|----------|--------------|-----|
| **MCP** (Streamable HTTP, 2025-03-26) | ✅ stdio + SSE; Streamable HTTP planned P0-5 | Implement Streamable HTTP transport |
| **A2A** (Google, 2025) | ✅ Core implementation | Bidirectional full surface (R8) |
| **ACP** (Zed, 2025) | ✅ Bridge exists | Production hardening |
| **AG-UI** (CopilotKit, 2025) | 🔜 P1-1 | Streaming frontend protocol |
| **OpenTelemetry GenAI** | 🔜 P0-4 | Semantic conventions for LLM spans |
| **TACO** (Construction A2A, 2026) | 🔜 Adapter | A2A schemas for construction domain |

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

**What's needed:**
```typescript
// packages/engine/src/runtime/block-sdk.ts

interface BlockDefinition {
  id: string;
  name: string;
  version: string;
  engineVersionRange: string;     // e.g., ">=0.3.0 <1.0.0"
  
  // What this block provides
  capabilities: BlockCapability[];
  tools: ToolDefinition[];
  skills: string[];               // skill IDs from registry
  
  // How it integrates
  panels: PanelDefinition[];      // IDE panels
  routes: RouteDefinition[];      // Gateway routes
  memoryTables: MemoryTableDef[]; // Custom SQLite tables
  
  // Governance
  requiredPermissions: Permission[];
  budgetScope: BudgetScope;
  
  // Lifecycle
  onInstall: () => Promise<void>;
  onActivate: () => Promise<void>;
  onDeactivate: () => Promise<void>;
  onUpgrade: (fromVersion: string) => Promise<void>;
}

interface BlockCapability {
  type: 'tool' | 'skill' | 'panel' | 'route' | 'protocol' | 'memory';
  spec: Record<string, unknown>;
}
```

**Gap:** No Block SDK exists. Blocks are hand-wired, not pluggable.

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

### 3.8 Summary Gap Matrix

| # | Gap | Priority | Complexity | Phase |
|---|-----|----------|------------|-------|
| G1 | Block SDK | P0 | L | Foundation |
| G2 | Block Composition Protocol | P1 | M | Foundation |
| G3 | Memory Scoping | P1 | M | Foundation |
| G4 | UI Panel Registry | P1 | M | Desktop |
| G5 | Block Marketplace | P2 | L | Ecosystem |
| G6 | Industrial Templates | P2 | L | Domain |
| G7 | Team Features | P3 | XL | Enterprise |
| G8 | Streamable HTTP (MCP) | P0 | M | Already P0-5 |
| G9 | AG-UI Protocol | P1 | M | Already P1-1 |
| G10 | OTel GenAI | P0 | M | Already P0-4 |

---

## 4. Strategic Roadmap

### Phase A: Block Foundation (next — 2-4 weeks)

```
G1: Block SDK
  └─ Define BlockDefinition, BlockCapability types
  └─ Implement BlockLoader (discovers blocks from ~/.pyrfor/blocks/)
  └─ Block lifecycle: install → activate → deactivate → remove
  └─ CLI: pyrfor block init, pyrfor block validate, pyrfor block dev

G3: Memory Scoping
  └─ Namespaced memory per block
  └─ Cross-block read with permission

G4: UI Panel Registry
  └─ Slot system (left, center, right, bottom)
  └─ Dynamic panel registration
  └─ Panel visibility toggle
```

### Phase B: Block Ecosystem (4-8 weeks)

```
G2: Block Composition Protocol
  └─ Typed contracts between blocks
  └─ Event bus for block communication
  └─ Data schemas for common outputs (CostBreakdown, Schedule, Document)

G5: Block Marketplace
  └─ Block publishing flow
  └─ Block search/install/upgrade
  └─ Dependency resolution
  └─ Block signing and verification

G6: Industrial Templates (first 3)
  └─ Estimate Block template
  └─ Schedule Block template
  └─ Docs Block template (1C OData connector)
```

### Phase C: Protocol Completion (parallel with Phase A/B)

```
P0-5: MCP Streamable HTTP
P0-4: OpenTelemetry GenAI
P1-1: AG-UI Protocol
P1-3: ACP server → Zed/JetBrains
```

### Phase D: Enterprise (3-6 months)

```
G7: Team Features
  └─ Shared memory sync
  └─ RBAC
  └─ Team audit log
  └─ Block deployment to team
```

---

## 5. Block Template Specification

### 5.1 Estimate Block (Сметный блок)

**Purpose:** Создание и проверка сметной документации.

**Tools:**
- `calculate_volume(dimensions, material)` → quantity
- `lookup_rate(code_TER)` → unit cost
- `apply_coefficient(base_cost, conditions)` → adjusted cost
- `generate_ks2(sections)` → КС-2 form
- `validate_against_mds(estimate)` → compliance report

**Skills:**
- `estimate-calculator` — методика расчёта по МДС 81-35.2004
- `ter-database` — база ТЕР (территориальных единичных расценок)

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
  profit REAL          -- сметная прибыль
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

**Skills:**
- `1c-odata-connector` — работа с OData 1С (Базис-Тюмень)
- `document-parser` — MarkItDown-based parsing

**UI Panel:** Document list with search, attachment preview, 1C import wizard.

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
| Block SDK too complex | Medium | Blocks don't get built | Start with 1 template, iterate |
| Industrial standards change | Low | Regulatory Block outdated | Standards as versioned skills |
| Team adoption slow | Medium | Solo-only Pyrfor | Focus on individual value first |
| Competitor builds faster | Medium | Lose first-mover advantage | Open-source + governed = moat |
| Over-engineering | High | Never ship | Each phase delivers value independently |

---

## 8. Success Metrics

| Metric | Today | 3 months | 12 months |
|--------|-------|----------|-----------|
| Core blocks (built-in) | 1 (Coding) | 5 | 8 |
| Industrial blocks | 0 | 3 (Estimate, Docs, Regulatory) | 7+ |
| Community blocks | 0 | 5+ | 50+ |
| Block SDK adoption | 0 | Internal use | External devs |
| Time to create a block | Manual weeks | 1 day with SDK | 1 hour with template |
| GOST/СНиП coverage | 0% | 30% (core standards) | 80% |

---

## 9. Immediate Next Actions

1. **Block SDK spec** — formal TypeScript interfaces (this week)
2. **Block SDK implementation** — `packages/engine/src/runtime/block-sdk.ts`
3. **First industrial template** — Estimate Block (highest Саша value)
4. **Memory scoping** — per-block namespaces
5. **Panel registry** — dynamic panel API in IDE

---

*This document refines PYRFOR-ECOSYSTEM-VISION.md into an actionable strategic plan with concrete gaps, standards, and specifications.*

**Author:** Клод Гребешок 🐾 | 2026-05-15
