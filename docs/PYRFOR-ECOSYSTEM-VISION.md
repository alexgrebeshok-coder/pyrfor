# Pyrfor Ecosystem — The Complete Picture

**Date:** 2026-05-15
**Status:** Vision document — how everything fits together

---

## 0. The Big Idea

Pyrfor is not a chatbot. Not a coding assistant. It's an **operating system for AI-powered work**.

Like an OS kernel, the Pyrfor Engine provides governed execution, memory, permissions, and tool access. On top of it, you run **blocks** — modular AI-powered applications that connect through standard protocols.

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
│  │              PYRFOR MARKETPLACE                      │ │
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
- **A2A** (Agent-to-Agent) — communicate with other agents
- **ACP** (Agent Communication Protocol) — IDE integration (Zed, VS Code)
- **AG-UI** — streaming frontend protocol (CopilotKit-compatible)
- **OpenTelemetry GenAI** — observability for every LLM call

**Safety by Default**
- Sandbox execution (worktree → microsandbox → cloud)
- Permission ladder (read_fs, write_fs, network, exec, secret_read)
- Circuit breaker (auto-disable failing providers)
- Cost guardrails (per-run, per-session, per-day budgets)
- NeverEditableByOptimizer controls

### 1.2 Pyrfor Desktop — The Interface

Tauri 2 + React + Monaco. Native macOS app, also runs in browser.

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

Every item in Marketplace is:
- Tested (automated acceptance tests)
- Governed (approval flow, audit trail)
- Versioned (skill versions, rollback support)

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
                         │      PYRFOR MARKETPLACE      │
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

---

## 9. What's Ready Today (May 15, 2026)

✅ **Engine:** 150+ modules, 5900+ tests, governed lifecycle, 10 LLM providers, MCP/A2A/ACP, memory v2, self-improvement SI1-SI8
✅ **Desktop:** Tauri 2 app, Monaco editor, chat, terminal, trust panel, orchestration, governed strip
✅ **CLI:** concept, migrate, skills (test/approve/import), release check
✅ **Marketplace foundation:** Skills import→test→approve flow, governed registry
✅ **Self-improvement:** Closed loop, experience library, pattern miner, optimizer agents, M15 shell

🔄 **Coming:** Industrial blocks, Vision/Docs blocks, Cloud deployment, VS Code extension

---

## 10. Why This Matters for Саша

You work with:
- **Construction estimates** (сметы) → Estimate Block
- **Tender documents** → Tender Block  
- **Schedule control** → Schedule Block
- **Quality documentation** (ГОСТ/СНиП) → Quality Block + Regulatory Block
- **Supply chain** (бентонит, дунит) → Supply Chain Block
- **Budget oversight** ($500M+) → Budget Block + CEOClaw Dashboard
- **1C integration** (Базис-Тюмень) → Docs Block with OData connector

Today you use separate tools (Excel, 1C, Word, Telegram, почта). Tomorrow: **one platform** where all blocks share memory, governed by one engine, visible in one desktop.

---

*This is the vision. The foundation is built. Now we fill it with blocks.*

**Author:** Клод Гребешок 🐾 | Council: Main synthesis | 2026-05-15
