# Pyrfor Ecosystem — The Complete Picture

**Date:** 2026-05-15
**Status:** Vision v1.2 — production-readiness refinement

---

## 0. The Big Idea

Pyrfor is not a chatbot. Not a coding assistant. It's an **operating system for AI-powered work**.

Like an OS kernel, the Pyrfor Engine provides governed execution, memory, permissions, and tool access. On top of it, you run **blocks** — modular AI-powered applications that connect through standard protocols.

**Council refinement:** the platform should be introduced through a narrow, high-value industrial wedge before it is sold as a universal AI OS:

> **A local, audit-ready AI workbench for regulated construction workflows: documents, 1C, КС-2/КС-3, estimates, BIM evidence, and regulatory checks.**

The long-term architecture remains an AI OS, but the first proof of value is a concrete workflow: import documents from 1C/PDF/Excel, reconcile them against estimates/contracts, expose discrepancies, and preserve evidence for human approval.

```
┌─────────────────────────────────────────────────────────┐
│                    PYRFOR ECOSYSTEM                      │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  CODING  │  │  DESIGN  │  │  ANALYTICS│  │  DOCS  │ │
│  │  BLOCK   │  │  BLOCK   │  │   BLOCK   │  │  BLOCK │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │              │            │       │
│  ┌────┴──────────────┴──────────────┴────────────┴────┐ │
│  │                 PYRFOR ENGINE                       │ │
│  │  Lifecycle • Memory • Sandbox • Skills • Protocols  │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────┴──────────────────────────────┐ │
│  │                 PYRFOR DESKTOP                       │ │
│  │  IDE • Chat • Trust Panel • Timeline • Terminal     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │        PYRFOR MARKETPLACE (Phase D aspirational)     │ │
│  │  Skills • Blocks • MCP Servers • Industry Modules   │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Three Layers

### 1.1 Pyrfor Engine — The Kernel

The Engine is a **TypeScript runtime** that every block uses. It provides:

**Governed Lifecycle**
```
plan → research → execute → critique → postmortem → memory_persist → done
```
Every action goes through this cycle. Plans are approved. Execution is sandboxed. Results are audited. Failures produce postmortems. The system learns.

**Universal Memory (SQLite+FTS5)**
- Structured records with full-text search
- Wiki-style rollup for knowledge organization
- Cross-session persistence
- Memory v2: governed reviews, contradiction detection, approval flow

**Skills System**
- Import from OpenClaw/ClawHub SKILL.md → governed quarantine → test → approve → vetted
- Publish your own skills to Marketplace
- Skills extend Engine capabilities without touching core code

**Protocol Stack**
- **MCP** (Model Context Protocol) — connect any MCP server for tools/resources
- **A2A** (Agent-to-Agent) — communicate with other agents; every block should publish an Agent Card
- **ACP** (Agent Communication Protocol) — IDE integration (Zed, VS Code)
- **ACP-style trajectory metadata** — standardize postmortems and audit traces
- **AG-UI** — streaming frontend protocol (CopilotKit-compatible)
- **OpenTelemetry GenAI** — observability for every LLM call
- **IFC/BCF/bSDD** — BIM model, issue, and classification protocols for industrial blocks

**Safety by Default**
- Sandbox execution (worktree → microsandbox → cloud)
- Permission ladder (read_fs, write_fs, network, exec, secret_read)
- Circuit breaker (auto-disable failing providers)
- Cost guardrails (per-run, per-session, per-day budgets)
- NeverEditableByOptimizer controls, formalized in `Block Manifest v1` as `optimizer_policy.never_editable`

### 1.2 Pyrfor Desktop — The Interface

Tauri 2 + React + Monaco. v1.0/v1.2 target is native desktop: macOS, Linux, Windows. Browser mode can share UI code for development and selected internal deployments, but the product promise is desktop-first local execution.

**Deployment targets:**

| Target | Scope |
|--------|-------|
| macOS / Linux / Windows desktop | v1 core |
| Browser/PWA | Internal/dev reuse; not the primary regulated deployment |
| iOS / Android mobile | Phase E after market validation |
| Server/team deployment | Enterprise phase after single-user workflow is proven |

**Panels:**
- **Files** — tree view, git status, search
- **Editor** — Monaco with syntax highlighting
- **Chat** — talk to agents, see streaming responses
- **Terminal** — integrated shell with daemon management
- **Trust Panel** — approve/reject agent actions, view permission grants
- **Orchestration** — lifecycle phases, subagent spawns, run timeline
- **Governed Strip** — live snapshot: Runs, Blocked, Approvals, Effects

**Key design:** Browser and Desktop share code. `isTauriRuntime()` branches platform-specific behavior.

### 1.3 Pyrfor Marketplace — The Ecosystem

A governed registry of:
- **Skills** — reusable AI capabilities (imported from OpenClaw or created)
- **Blocks** — full applications built on Engine
- **MCP Servers** — tool servers for any domain
- **Industry Modules** — domain-specific blocks (construction, logistics, etc.)

**v1.2 scope decision:** Marketplace is a Phase D aspirational layer. The near-term focus is internal industrial blocks and certification mechanics. A public block marketplace should only be built after internal block certification works and at least three external developers request the SDK and pass a certification pilot.

Every item in Marketplace is:
- Tested (automated acceptance tests)
- Governed (approval flow, audit trail)
- Versioned (skill versions, rollback support)
- Signed (package signature, SBOM, provenance, revocation)

---

## 2. The Block Model — Multi-Modal Architecture

### 2.1 What is a Block?

A **block** is a self-contained application that:
- Runs on Pyrfor Engine
- Has its own prompts, tools, skills, and UI
- Connects to other blocks via standard protocols
- Can be installed from Marketplace

Think of blocks as **apps on an app store**, but for AI workflows.

### 2.2 Block Types (Current + Planned)

| Block | Domain | Status |
|-------|--------|--------|
| **Coding Block** | Code generation, debugging, refactoring | ✅ Core |
| **CEOClaw Block** | Project management, construction oversight | 🔄 Migration |
| **Vision Block** | Image analysis, blueprint reading, photo→report | 🔜 Planned |
| **Design Block** | UI/UX design, color systems, typography | 🔜 Planned |
| **Analytics Block** | Data analysis, charts, budget tracking | 🔜 Planned |
| **Docs Block** | Document analysis, 1C integration, PDF/Markdown | 🔜 Planned |
| **Voice Block** | STT/TTS, voice commands, meeting notes | 🔜 Planned |
| **Browser Block** | Web automation, scraping, form filling | 🔜 Planned |

### 2.3 Industrial Blocks (Construction/Domain)

Саша's domain — construction, infrastructure, mining:

| Block | What it does |
|-------|-------------|
| **Estimate Block** | Сметы, КС-2, КС-3, акты |
| **Tender Block** | Тендерная документация, сравнение предложений |
| **Schedule Block** | Календарные планы, диаграмма Ганта, контроль сроков |
| **Quality Block** | Акты освидетельствования, исполнительная документация |
| **Supply Chain Block** | Поставки материалов, логистика, карьеры |
| **Budget Block** | Бюджетирование, поквартальный контроль, EVM |
| **Regulatory Block** | Проверка на соответствие ГОСТ/СНиП/СП |
| **BIM/CDE Block** | IFC/BCF/IDS/ISO 19650, модели, ревизии, CDE-пакеты |
| **Project Controls Block** | WBS/CBS, EVM, CPI/SPI, прогноз EAC |
| **Field QA/QC Block** | Фото, геометки, осмотры, акты скрытых работ — Phase E; requires mobile/PWA decision |
| **Regulatory Evidence Block** | Версии норм, ссылки на пункты, доказательная база |

All of these connect to Pyrfor Engine the same way — through governed lifecycle, shared memory, and standard protocols.

### 2.4 How Blocks Connect

```
┌─────────────┐         ┌─────────────┐
│  ESTIMATE   │────────▶│   BUDGET    │
│   BLOCK     │  costs  │   BLOCK     │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │  materials            │  budget data
       ▼                       ▼
┌─────────────┐         ┌─────────────┐
│ SUPPLY CHAIN│         │  ANALYTICS  │
│    BLOCK    │         │   BLOCK     │
└─────────────┘         └─────────────┘
       │                       │
       └───────────┬───────────┘
                   │
                   ▼
          ┌─────────────┐
          │  CEOCLAW    │
          │  DASHBOARD  │
          └─────────────┘
```

Blocks communicate through:
1. **Shared Memory** — Engine's SQLite+FTS5 store, scoped per project
2. **A2A Protocol** — direct agent-to-agent task delegation
3. **MCP Tools** — each block exposes tools others can call
4. **Event Bus** — lifecycle events broadcast to all blocks
5. **Contract Registry** — every cross-block payload is schema-validated
6. **Artifact Ledger** — every output keeps lineage: inputs, model, prompt, tools, block version, reviewer

**Legal weight:** Artifact Ledger is a technical audit trail, not a legally significant electronic signature. In Community v1, it proves lineage for internal review; it does not replace КЭП, accredited TSP timestamps, or an ЭДО process. Russian enterprise deployments that require legal signing need the Pro GSM path described in `docs/specs/RU-COMPLIANCE-SCOPE.md`.

### 2.5 Block Runtime Contract

The next architecture layer is the **Block Runtime Contract**: the stable boundary between Pyrfor Engine and every block.

```
block package
├── block.json          # manifest: runtime, permissions, contracts, events, UI, migrations
├── contracts/          # JSON Schema / Zod schemas
├── prompts/            # versioned prompts
├── tools/              # block tools
├── memory/             # migrations
├── ui/                 # sandboxed panels
├── tests/              # acceptance fixtures
└── sbom.cdx.json       # supply-chain metadata
```

The lifecycle becomes:

```
install → verify → migrate → activate → run → suspend → upgrade → rollback → revoke → uninstall
```

Blocks do not receive raw trust. They receive **capability tokens**: time-limited permissions for project files, memory scopes, network targets, secrets, models, and tools.

`block.json` is the only canonical Block SDK contract. See `docs/specs/BLOCK-MANIFEST-V1.md`. Legacy imperative `BlockDefinition` callbacks are replaced by named lifecycle scripts.

### 2.6 Shared Industrial Ontology

Industrial blocks need one typed language:

```
Project → Contract → WBS/CBS → Document → BIMObject
        → EstimateItem → ScheduleActivity → SupplyItem
        → InspectionRecord → ChangeOrder → PaymentCertificate
```

Core contracts:
- `Document@1`
- `EstimateItem@1`
- `RegulatoryFinding@1`
- `BIMObject@1`
- `ScheduleActivity@1`
- `SupplyItem@1`
- `ApprovalEvidence@1`

Every entity carries `source_ref`, `version`, `author`, `timestamp`, `evidence_uri`, `confidence`, `approval_status`, and `lineage_artifact_id`.

---

## 3. How a User Works with Pyrfor

### 3.1 Daily Flow

```
Morning:
  ├─ Open Pyrfor Desktop
  ├─ Governed strip shows: 3 runs yesterday, 0 blocked, 2 pending approvals
  ├─ Chat: "What's the status of CHMK project?"
  └─ Engine queries memory, CEOClaw block, returns summary

During the day:
  ├─ Issue: "Check today's КС package from 1C"
  │   └─ Docs/1C Block + Estimate Reconciliation Block
  │       ├─ import (1C OData / PDF / Excel)
  │       ├─ extract line items, sums, counterparties
  │       ├─ match against estimate, contract, previous acts
  │       ├─ produce discrepancies with source evidence
  │       └─ Trust Panel: human approves/rejects findings
  │
  ├─ Issue: "Estimate the foundation for the new building"
  │   └─ Engine spins up Estimate Block
  │       ├─ plan → research (pulls norms from Regulatory Block)
  │       ├─ execute (calculates quantities + costs)
  │       ├─ critique (verifier checks against ГОСТ)
  │       └─ postmortem (stores results + patterns for reuse)
  │
  ├─ Issue: "Import this 1C document and extract line items"
  │   └─ Docs Block + 1C OData connector
  │       ├─ Reads attached files from 1C
  │       ├─ Extracts data into structured memory
  │       └─ Feeds into Estimate Block
  │
  └─ Issue: "What risks do we have this week?"
      └─ CEOClaw Block queries all project blocks
          └─ Returns unified risk report

Evening:
  ├─ Nightly meeting auto-generates (based on day's runs)
  ├─ Self-improvement: Pattern Miner finds new optimization
  ├─ Optimizer proposes: "Budget Block threshold should be 80% not 90%"
  └─ You review in Trust Panel → Approve or Reject
```

### 3.2 What You See

```
┌──────────────────────────────────────────────────────────┐
│ ≡ Pyrfor  │ 🟢 Runs:3  ⛔ Blocked:0  ✅ Approvals:2    │ ← governed strip
├───────────┴──────────────────────────────────────────────┤
│ FILES │▐│ EDITOR              │▐│ CHAT                   │
│       │▐│                     │▐│                         │
│ 📁 chmk│▐│ // estimate.ts     │▐│ You: Estimate foundation│
│  📄 est│▐│                     │▐│                         │
│  📄 ten│▐│ const foundation = │▐│ Agent: Plan created.    │
│  📄 sch│▐│   calculateBase()  │▐│ → Research: ГОСТ 7473  │
│ 📁 bent│▐│                     │▐│ → Execute: 320m³, ₽2.4M│
│  📄 sup│▐│                     │▐│ → Critique: ✅ passed   │
│  📄 log│▐│                     │▐│ → Postmortem: saved    │
├─────────┴─────────────────────┴──────────────────────────┤
│ TERMINAL │ Trust Panel │ Orchestration │                 │
│ $ pyrfor concept "analyze risks"                         │
│ Lifecycle: plan→research→execute→critique→done            │
└──────────────────────────────────────────────────────────┘
```

---

## 4. How Blocks are Created

### 4.1 Structure of a Block

```
my-block/
├── block.json          # metadata: name, version, capabilities
├── prompts/
│   └── system.md       # system prompt for this block's agent
├── tools/
│   └── calculate.ts    # custom tools
├── skills/
│   └── my-skill/       # imported or custom skills
│       └── SKILL.md
├── memory/
│   └── schema.sql      # domain-specific memory tables
└── ui/
    └── Panel.tsx        # custom IDE panel
```

### 4.2 Publishing to Marketplace

```
1. Develop block locally
2. pyrfor block validate ./my-block
3. pyrfor block publish ./my-block
   → Goes to quarantine
   → Automated tests run
   → If approved → Marketplace
4. Others: pyrfor marketplace install my-block
```

---

## 5. The Self-Improvement Loop

Every run feeds the system:

```
                 ┌──────────────────┐
                 │   AGENT RUN      │
                 │ plan→research→   │
                 │ execute→critique→│
                 │ postmortem       │
                 └────────┬─────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                 ▼
┌─────────────────┐ ┌──────────┐  ┌──────────────────┐
│ EXPERIENCE      │ │ PATTERN  │  │ OPTIMIZER        │
│ LIBRARY         │ │ MINER    │  │ AGENTS           │
│ (what worked)   │ │ (find    │  │ (propose         │
│                 │ │  patterns│  │  improvements)   │
└────────┬────────┘ └────┬─────┘  └────────┬─────────┘
         │               │                 │
         └───────────────┼─────────────────┘
                         ▼
              ┌──────────────────┐
              │ NEXT RUN IS      │
              │ BETTER           │
              └──────────────────┘
```

This is not theoretical — **SI1–SI8 are already implemented** (May 15, 2026).

Air-gapped rule: self-improvement is local-first. OpenTelemetry GenAI spans go to a local collector/store by default; Pattern Miner reads local project/session data; Optimizer proposes diffs through Trust Panel. No telemetry leaves the machine or on-prem network unless the operator explicitly enables export.

Optimizer cannot directly rewrite block packages. Block-level edit boundaries are declared in `block.json.optimizer_policy`: `never_editable` fields are absolute, and sensitive changes require human approval.

---

## 6. The Migration Path (OpenClaw → Pyrfor)

### 6.1 What moves

| From OpenClaw | To Pyrfor | How |
|---------------|-----------|-----|
| SKILL.md files | Pyrfor Skills Registry | `pyrfor migrate openclaw --import` |
| MEMORY.md + memory/*.md | Pyrfor Memory v2 (SQLite+FTS5) | Import with governed review |
| Sessions/conversations | Pyrfor Memory — historian | Structured import |
| Config (providers, keys) | Pyrfor Runtime Config | Migration wizard |
| Voice pipeline (Whisper+TTS) | Pyrfor Voice Block | Reuse same binaries |

### 6.2 What we gain

- Desktop app (not just terminal/Telegram)
- Governed lifecycle (not just chat)
- Sandbox execution (real safety)
- Self-improvement (closed loop)
- Marketplace (ecosystem)
- Multi-block architecture (industrial use)

---

## 7. The Full Picture (One Diagram)

```
                         ┌──────────────────────────────┐
                         │ PYRFOR MARKETPLACE (Phase D) │
                         │  Skills • Blocks • MCP • ... │
                         └──────────────┬───────────────┘
                                        │ install / publish
          ┌─────────────────────────────┼─────────────────────────────┐
          │                             │                             │
          ▼                             ▼                             ▼
┌──────────────────┐  ┌─────────────────────────┐  ┌──────────────────┐
│  INDUSTRIAL      │  │      CORE BLOCKS        │  │  COMMUNITY       │
│  Estimate Block  │  │  Coding • Chat • Voice  │  │  Blocks from     │
│  Tender Block    │  │  Vision • Browser       │  │  ecosystem       │
│  Schedule Block  │  │  Docs • Analytics       │  │                  │
│  Quality Block   │  │  Design                 │  │                  │
│  Supply Chain    │  │                         │  │                  │
│  Budget Block    │  │                         │  │                  │
│  Regulatory Blk  │  │                         │  │                  │
└────────┬─────────┘  └────────────┬────────────┘  └────────┬─────────┘
         │                         │                        │
         └─────────────────────────┼────────────────────────┘
                                   │
                                   ▼
          ┌─────────────────────────────────────────────────┐
          │                 PYRFOR ENGINE                    │
          │                                                 │
          │  ┌───────────┐  ┌──────────┐  ┌─────────────┐  │
          │  │ Lifecycle │  │  Memory  │  │  Sandbox    │  │
          │  │ Governor  │  │  (FTS5)  │  │  (worktree) │  │
          │  └───────────┘  └──────────┘  └─────────────┘  │
          │                                                 │
          │  ┌───────────┐  ┌──────────┐  ┌─────────────┐  │
          │  │ Protocols │  │  Skills  │  │  Self-Impr  │  │
          │  │ MCP/A2A   │  │  Registry│  │  OS (SI1-8) │  │
          │  └───────────┘  └──────────┘  └─────────────┘  │
          │                                                 │
          │  ┌───────────┐  ┌──────────┐  ┌─────────────┐  │
          │  │ Providers │  │  Permiss │  │  Cost Guard │  │
          │  │ (10+ LLM) │  │  Ladder  │  │  Budget     │  │
          │  └───────────┘  └──────────┘  └─────────────┘  │
          └──────────────────────┬──────────────────────────┘
                                 │
          ┌──────────────────────┴──────────────────────────┐
          │              PYRFOR DESKTOP                      │
          │                                                 │
          │  ┌─────────┐ ┌────────┐ ┌───────────────────┐  │
          │  │  Files  │ │ Editor │ │  Chat + Agent     │  │
          │  └─────────┘ └────────┘ └───────────────────┘  │
          │                                                 │
          │  ┌─────────┐ ┌────────┐ ┌───────────────────┐  │
          │  │ Terminal│ │ Trust  │ │  Orchestration    │  │
          │  └─────────┘ └────────┘ └───────────────────┘  │
          │                                                 │
          │  Governed Strip • Color Tokens • Tauri Native   │
          └──────────────────────┬──────────────────────────┘
                                 │
          ┌──────────────────────┴──────────────────────────┐
          │              PYRFOR CLI                          │
          │  pyrfor concept • migrate • skills • release    │
          │  pyrfor marketplace • block • optimize          │
          └─────────────────────────────────────────────────┘
```

---

## 8. What Makes This Different

Not a chatbot. Not a coding tool. **A platform.**

| Aspect | Chatbot (ChatGPT, Claude) | Coding Agent (Aider, Cline) | Pyrfor |
|--------|--------------------------|---------------------------|--------|
| Execution | Single prompt→response | Code→apply | **Governed lifecycle** (plan→research→execute→critique→postmortem) |
| Safety | Prompt-level | Basic sandbox | **Permission ladder, real sandbox, circuit breaker** |
| Memory | Per-session | None | **SQLite+FTS5, cross-session, governed reviews** |
| Multi-domain | Chat only | Code only | **Blocks: code + docs + vision + analytics + industry** |
| Self-improvement | None | None | **Closed loop SI1-SI8** |
| Desktop | None | Terminal | **Native Tauri app** |
| Ecosystem | None | None | **Marketplace** |
| Industrial | No | No | **Construction, logistics, regulatory blocks** |
| Regulated workflows | Prompt disclaimers | Developer logs | **Artifact ledger, approval evidence, policy-as-code** |

---

## 9. What's Ready Today (May 15, 2026)

✅ **Engine:** 150+ modules, 5900+ tests, governed lifecycle, 10 LLM providers, MCP/A2A/ACP, memory v2, self-improvement SI1-SI8
✅ **Desktop:** Tauri 2 app, Monaco editor, chat, terminal, trust panel, orchestration, governed strip
✅ **CLI:** concept, migrate, skills (test/approve/import), release check
✅ **Marketplace foundation:** Skills import→test→approve flow, governed registry
✅ **Self-improvement:** Closed loop, experience library, pattern miner, optimizer agents, M15 shell

🔄 **Coming:** Industrial blocks, Vision/Docs blocks, Cloud deployment, VS Code extension

---

## 10. Honest Non-Goals for v1.0/v1.2

Pyrfor becomes more credible when it states what it does not do yet:

| Non-goal | Reason |
|----------|--------|
| Legally significant КЭП/ЭДО | Community v1 provides technical lineage only; GSM/КриптоПро integration is Pro/future scope |
| Mobile field capture | Field QA/QC needs camera/GPS/offline sync; mobile is Phase E after desktop wedge validation |
| Multi-user conflict-free sync | RBAC roles are planned, but team sync architecture is enterprise phase |
| КИИ category 1/2 deployments | Community v1 is not certified; regulated deployments require customer controls and CPD/Pro path |
| Bundled ФЕР/ТЕР/ГЭСН/ФСНБ databases | v1 uses bring-your-own data packs; no redistribution without license |
| Public block marketplace | Deferred until internal certification works and external developer demand is proven |
| Automatic final regulatory/legal conclusions | Pyrfor proposes findings; humans approve or reject |

---

## 11. Why This Matters for Саша

You work with:
- **Construction estimates** (сметы) → Estimate Block
- **Tender documents** → Tender Block  
- **Schedule control** → Schedule Block
- **Quality documentation** (ГОСТ/СНиП) → Quality Block + Regulatory Block
- **Supply chain** (бентонит, дунит) → Supply Chain Block
- **Budget oversight** ($500M+) → Budget Block + CEOClaw Dashboard
- **1C integration** (Базис-Тюмень) → Docs Block with OData connector

Today you use separate tools (Excel, 1C, Word, Telegram, почта). Tomorrow: **one platform** where all blocks share memory, governed by one engine, visible in one desktop.

The first wedge is not "replace the сметчик". It is safer and more valuable:

> **Check, reconcile, and explain construction documents before signing.**

Pyrfor should start by finding discrepancies between 1C documents, КС-2/КС-3, contracts, estimates, previous acts, and source evidence. Once trust is built, it expands into BIM-backed quantities, project controls, procurement, field QA/QC, and enterprise team workflows.

---

*This is the vision. The foundation is built. Now we fill it with blocks.*

**Author:** Клод Гребешок 🐾 | Council: Main synthesis + red-team + RU compliance | 2026-05-15
