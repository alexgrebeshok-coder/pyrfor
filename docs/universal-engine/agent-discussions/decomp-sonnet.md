# Pyrfor Universal Engine — Concrete File-Level Implementation Decomposition

---

## A. EXISTING FILES TO EXTEND

### `packages/engine/src/runtime/run-lifecycle.ts`
- Add `RunMode`: `'universal'` to the union (alongside `chat | edit | autonomous | pm`).
- Add `parent_concept_id?: string` to `RunRecord` — links a run back to the top-level concept request that spawned it.
- Add `engine_phase?: EnginePhase` (`'plan' | 'research' | 'tool_forge' | 'execute' | 'critique' | 'done'`) to `RunRecord`.

### `packages/engine/src/runtime/event-ledger.ts`
- Add new `LedgerEventType` literals (see section E below).
- Add corresponding discriminated-union interface shapes and include them in the `LedgerEvent` union.

### `packages/engine/src/runtime/durable-dag.ts`
- No structural change needed. New Universal Engine node `kind` strings (section F) are registered as plain strings — the DAG is already kind-agnostic.

### `packages/engine/src/runtime/artifact-model.ts`
- Add new `ArtifactKind` literals to the union and to `ARTIFACT_KINDS` set (section G below).

### `packages/engine/src/runtime/gateway.ts`
- Add new `pathname` route blocks for Universal Engine API surface (section D below).
- Import and wire `UniversalEngineOrchestrator` from `runtime/universal/engine-loop.ts`.
- Add `universalEngine?: UniversalEngineOrchestrator` to `GatewayDeps`.

### `packages/engine/src/runtime/cli.ts`
- Add `CLIMode` variants: `'concept' | 'plan' | 'run' | 'tool'`.
- Add argument parsing for `pyrfor concept ...`, `pyrfor plan ...`, `pyrfor run ...`, `pyrfor tool ...` (section J).

### `packages/engine/src/runtime/guardrails.ts`
- Add `'sandbox'` as a new `PermissionTier` between `review` and `restricted`.
- Add `sandboxBackend?: SandboxBackend` field to `GuardrailContext` so the sandbox executor decision can be policy-driven.

### `packages/engine/src/runtime/token-budget-controller.ts`
- Add `BudgetScope` variant: `'concept'` — tracks budget across the entire multi-phase universal run.
- Add `ConsumeRequest.phaseId?: string` for per-phase attribution.

### `packages/engine/src/runtime/approval-flow.ts`
- Add `ApprovalRequest.concept_id?: string` and `ApprovalRequest.engine_phase?: string` — universal runs need phase-scoped approval requests.

### `packages/engine/src/runtime/pyrfor-fc-skill-writer.ts`
- Add `SkillFrontmatter.version?: number` (bump on every rewrite for tool provenance).
- Add `SkillFrontmatter.toolKind?: ToolKind` (`'script' | 'api_client' | 'mcp_tool' | 'wasm_module'`) to distinguish ToolForge output.
- Add `SkillWriter.delete(name: string): Promise<boolean>` for cleanup after failed tool tests.

### `packages/engine/src/runtime/pyrfor-pattern-to-skill.ts`
- Add `PatternCandidate.toolKind?: ToolKind` propagated through `patternToSkill()`.

### `packages/engine/src/ai/orchestration/planner.ts`
- Add `buildUniversalPlan(concept: string, context: UniversalPlanContext): UniversalPlan` export — produces the phase sequence for the engine loop.
- `UniversalPlan` is a thin wrapper over `CollaborationPlan` that adds `phases: EnginePhase[]`, `researchRequired: boolean`, `missingTools: string[]`.

### `packages/engine/src/ai/orchestration/reflection.ts`
- Add `ReflectionOptions.phaseId?: string` — Critic calls reflection per phase, not just per full response.
- Add `ReflectionResult.phaseCritique?: Record<string, ReflectionScore>`.

### `packages/engine/src/runtime/memory-store.ts`
- Add `MemoryKind` variant: `'strategy'` — for Strategy Store entries (long-lived, high-weight, scope=`strategy`).
- Add `MemoryKind` variant: `'tool_result'` — caches validated ToolForge output references.

### `packages/engine/src/runtime/verifier-lane.ts`
- Add `VerifierLaneOptions.conceptId?: string` — group multi-phase verifications by concept.
- Add `VerifierLaneResult.phaseResults?: Record<string, VerificationReport>` for per-phase reporting.

### `packages/engine/src/runtime/index.ts` (PyrforRuntime)
- Add `universalEngine?: UniversalEngineOrchestrator` property.
- Wire `startUniversalEngine()` / `stopUniversalEngine()` lifecycle methods.
- Export `dispatchConcept(input: ConceptInput): Promise<ConceptHandle>`.

---

## B. NEW FILES TO INTRODUCE

All new files live under `packages/engine/src/runtime/universal/`.

---

### `packages/engine/src/runtime/universal/types.ts`
All shared type contracts for the Universal Engine. Defines `ConceptInput`, `ConceptHandle`, `ConceptStatus`, `EnginePhase`, `PlanDocument`, `ResearchResult`, `ToolManifest`, `CritiqueReport`, `StrategyEntry`, `SandboxBackend`, `ToolKind`. No runtime code — pure TypeScript interfaces and enums. Every other universal module imports from here; nothing outside `universal/` depends on this file, which makes the boundary clean and prevents circular imports.

---

### `packages/engine/src/runtime/universal/engine-loop.ts`
**UniversalEngineOrchestrator** — the Main Loop. Accepts a `ConceptInput`, creates a `RunRecord` via `RunLedger` in mode `'universal'`, then sequences phases: `plan → research? → tool_forge? → execute → critique → memory_persist → done`. Each phase is a `DurableDag` node; the loop drives nodes through `leaseNode/startNode/completeNode`. Emits `concept.*` ledger events at every phase boundary. Exposes `dispatchConcept()`, `getStatus()`, `abort()`. Maintains an in-memory `Map<conceptId, ConceptHandle>` for live tracking. Idempotent restart: re-hydrates DAG from disk on construction.

---

### `packages/engine/src/runtime/universal/planner.ts`
**UniversalPlanner** — converts a free-form concept string into a `PlanDocument` (structured JSON artifact). Uses an LLM call via `ai/orchestration/planner.ts`'s `buildUniversalPlan()`. Stores the plan as an `ArtifactRef` of kind `'plan'`. Returns `{ planRef: ArtifactRef, plan: PlanDocument, phases: EnginePhase[], missingTools: string[], researchTopics: string[] }`. Stateless: given the same concept + context hash it produces deterministic output (cached via idempotency key on the plan artifact sha256).

---

### `packages/engine/src/runtime/universal/researcher.ts`
**UniversalResearcher** — executes one research topic at a time by delegating to `runtime/research-search.ts` (governed web search) and `runtime/research-source-capture.ts`. Aggregates results into a `ResearchResult` written as an `ArtifactRef` of kind `'research_source_capture'`. Respects `ApprovalFlow` (every web search is an `ask`-category effect). Supports offline mode: if no search provider is configured, falls back to LLM grounding only. Exposes `research(topic: string, runId: string): Promise<ArtifactRef>`.

---

### `packages/engine/src/runtime/universal/tool-forge.ts`
**ToolForge** — the self-extension engine. Given a `ToolManifest` (name, description, kind, acceptance criteria), it: (1) checks `ToolRegistry` for an existing matching tool; (2) if absent, prompts FreeClaude via `pyrfor-fc-adapter.ts` to generate the tool implementation inside a `SandboxExecutor`; (3) runs the generated tool against its acceptance tests via `SandboxExecutor.run()`; (4) on pass, registers the validated tool in `ToolRegistry`; (5) on fail, retries up to `maxForgeAttempts` (default 3) with error feedback. Writes the generated implementation as an `ArtifactRef` of kind `'tool_source'`. Emits `tool.forge.*` ledger events throughout.

---

### `packages/engine/src/runtime/universal/tool-registry.ts`
**ToolRegistry** — append-only JSONL registry of validated tools. Backed by `~/.pyrfor/tool-registry.jsonl`. Each entry is a `RegistryEntry` (see section H). Exposes: `register(entry)`, `find(query)`, `list(filter?)`, `retire(id)`, `loadAll()`. Deduplication: tools with the same `contentHash` are not re-registered. The registry is read on every engine loop startup; write is atomic (tmp → rename). Consumers in `tool-forge.ts` and `engine-loop.ts` use `ToolRegistry` to avoid re-forging tools that already exist.

---

### `packages/engine/src/runtime/universal/sandbox-executor.ts`
**SandboxExecutor** — abstraction over multiple execution backends for LLM-generated code. Implements `ISandboxExecutor` (section I). Selects backend based on tool kind + guardrails policy: `local-process` for scripts in a restricted cwd; `docker` for arbitrary code when Docker daemon is available; `wasm` for pure-compute tools (future). Each backend enforces: working-directory isolation, wall-clock timeout, stdout/stderr capture, exit-code propagation. Result is a `SandboxResult` written as `ArtifactRef` of kind `'sandbox_result'`. Integrates with `token-budget-controller.ts` to track wall-clock cost.

---

### `packages/engine/src/runtime/universal/critic.ts`
**UniversalCritic** — wraps `runtime/verifier-lane.ts` and `ai/orchestration/reflection.ts` into a single per-phase verdict. Accepts phase artifacts (plan/research/execution output) as `ArtifactRef[]`, runs the `VerifierLane` validators, then calls `reflectionLoop()` on the LLM if validator verdicts are `warning` or below. Returns a `CritiqueReport` (pass/rework/block + structured findings). If `rework`, the engine loop requeues the prior phase DAG node. Max rework cycles per phase is configurable (default 2) to prevent infinite loops.

---

### `packages/engine/src/runtime/universal/memory-facade.ts`
**MemoryFacade** — unified read/write surface over short-term (session `MemoryStore`) and long-term (scoped `MemoryStore` + `MemoryBridge`) memory. Exposes `remember(entry)`, `recall(query)`, `consolidate(runId)`. `consolidate()` is called at concept completion: it extracts high-value facts from the run's artifact trail and writes them as `MemoryKind='episode'` entries. Delegates to `runtime/memory-store.ts`; does NOT use the client-side `memory/memory-manager.ts`.

---

### `packages/engine/src/runtime/universal/strategy-store.ts`
**StrategyStore** — persistent store for high-level user strategies and domain principles. Built on top of `runtime/memory-store.ts` with `kind='strategy'` and `scope='strategy'`. Strategies survive across concepts and are injected into every Planner prompt as "standing instructions." Exposes `setStrategy(key, value, meta?)`, `getStrategy(key)`, `listStrategies()`, `deleteStrategy(key)`. Backed by the same SQLite DB as `MemoryStore`; no separate file.

---

### `packages/engine/src/runtime/universal/self-extension-loop.ts`
**SelfExtensionLoop** — the Self-Extension Loop as a standalone module. Called from `engine-loop.ts` during the `tool_forge` phase. Iterates `missingTools` list from the `PlanDocument`: for each missing tool, calls `ToolForge.forge()`, validates, registers. Emits `extension.*` ledger events. If forge fails after all retries, marks that subtask as `blocked` in the DAG and emits `extension.tool_blocked` so the Critic can decide whether to proceed with degraded capability or abort.

---

### `packages/engine/src/runtime/universal/concept-store.ts`
**ConceptStore** — JSONL append-only store for concept lifecycle records (`ConceptRecord`). Analogous to `goal-store.ts` but for engine concepts. Fields: `conceptId`, `goal`, `status`, `phases`, `artifactRefs`, `createdAt`, `completedAt`, `error`. Exposes `create()`, `update()`, `get()`, `list()`, `readAll()`. Backed by `~/.pyrfor/concepts.jsonl`. Used by gateway `/api/concepts` endpoints.

---

### `packages/engine/src/runtime/universal/index.ts`
Barrel re-export for the `universal/` subdirectory. Re-exports `UniversalEngineOrchestrator`, `ToolRegistry`, `StrategyStore`, `MemoryFacade`, all public types from `types.ts`. This is the only import surface external code uses; nothing reaches into individual universal modules directly.

---

### `packages/engine/src/evals/universal-engine-evals.ts`
Deterministic eval suite for the Universal Engine main loop. Tests: plan generation from a known concept, tool-forge happy-path (mock sandbox), critic rework cycle termination, memory consolidation after run completion. Uses `vitest`. Mirror of the existing `evals/agent-evals.ts` pattern.

---

## C. NEW PACKAGES

### `packages/sandbox` *(new)*
- **Scope:** Docker + WASM sandbox backends pulled out of `engine` so that `engine` does not take a hard dep on `dockerode` or `wabt`.
- **Exports:** `DockerSandboxBackend`, `WasmSandboxBackend`, both implementing `ISandboxExecutor` from `packages/engine/src/runtime/universal/sandbox-executor.ts`.
- **Deps:** `dockerode`, `@assemblyscript/loader` (optional peer), `packages/engine` (for `ISandboxExecutor` type only — imported as a type, no runtime coupling).
- **Structure:**
  ```
  packages/sandbox/
    src/
      docker-backend.ts
      wasm-backend.ts
      index.ts
    package.json
    tsconfig.json
  ```
- **Why separate:** keeps the engine package importable in environments without Docker. The engine's `sandbox-executor.ts` dynamically `import()`s the backend selected by config, so the dep is optional.

### `packages/cli` *(new)*
- **Scope:** Standalone `pyrfor` CLI binary with commands: `concept`, `plan`, `run`, `tool`, `status`. Thin shell over the engine's `UniversalEngineOrchestrator` and `ConceptStore` via HTTP to the gateway (or in-process when `--local`).
- **Deps:** `commander`, `packages/engine` (type-only for request/response shapes).
- **Structure:**
  ```
  packages/cli/
    src/
      index.ts          # commander root
      commands/
        concept.ts
        plan.ts
        run.ts
        tool.ts
        status.ts
      client.ts         # gateway HTTP client
    bin/pyrfor
    package.json
    tsconfig.json
  ```

---

## D. GATEWAY HTTP ENDPOINTS

All new routes added to `packages/engine/src/runtime/gateway.ts` as `pathname ===` blocks.

```
POST   /api/concepts
  Request:  { goal: string; workspaceId?: string; strategy?: string; dryRun?: boolean }
  Response: { conceptId: string; status: ConceptStatus; planRef?: string }

GET    /api/concepts
  Query:    ?status=active|done|failed&limit=20&offset=0
  Response: { concepts: ConceptRecord[] }

GET    /api/concepts/:conceptId
  Response: ConceptRecord & { artifactRefs: ArtifactRef[]; currentPhase: EnginePhase }

DELETE /api/concepts/:conceptId
  Request:  {} (empty — abort the in-flight concept)
  Response: { aborted: boolean }

GET    /api/concepts/:conceptId/plan
  Response: PlanDocument | { error: 'not_ready' }

GET    /api/concepts/:conceptId/phases
  Response: { phases: Array<{ phase: EnginePhase; status: DagNodeStatus; artifactRef?: string }> }

GET    /api/concepts/:conceptId/events/stream
  SSE stream of LedgerEvents filtered to conceptId

POST   /api/tools/forge
  Request:  { name: string; description: string; kind: ToolKind; acceptanceCriteria: string[] }
  Response: { toolId: string; status: 'queued' | 'forging' | 'registered' | 'failed' }

GET    /api/tools
  Query:    ?kind=script|api_client|mcp_tool|wasm_module&q=searchText
  Response: { tools: RegistryEntry[] }

DELETE /api/tools/:toolId
  Response: { retired: boolean }

GET    /api/strategy
  Response: { strategies: StrategyEntry[] }

POST   /api/strategy
  Request:  { key: string; value: string; domain?: string; rationale?: string }
  Response: StrategyEntry

DELETE /api/strategy/:key
  Response: { deleted: boolean }

GET    /api/memory/universal
  Query:    ?scope=strategy|episode|fact&q=text&limit=20
  Response: { entries: MemoryEntry[] }
```

---

## E. EventLedger EVENT TYPES

Add to `LedgerEventType` union in `runtime/event-ledger.ts`:

```typescript
// ─── Concept lifecycle ────────────────────────────────────────────────────
| 'concept.created'        // { concept_id, goal, workspace_id }
| 'concept.phase.started'  // { concept_id, phase: EnginePhase }
| 'concept.phase.completed'// { concept_id, phase: EnginePhase, artifact_ref?: string }
| 'concept.phase.rework'   // { concept_id, phase: EnginePhase, reason: string, attempt: number }
| 'concept.completed'      // { concept_id, ms: number }
| 'concept.failed'         // { concept_id, error: string, phase: EnginePhase }
| 'concept.aborted'        // { concept_id, reason: string }

// ─── ToolForge lifecycle ─────────────────────────────────────────────────
| 'tool.forge.started'     // { tool_name, kind: ToolKind, concept_id }
| 'tool.forge.attempt'     // { tool_name, attempt: number, sandbox_backend: SandboxBackend }
| 'tool.forge.test.passed' // { tool_name, attempt: number }
| 'tool.forge.test.failed' // { tool_name, attempt: number, error: string }
| 'tool.forge.registered'  // { tool_name, tool_id, content_hash }
| 'tool.forge.failed'      // { tool_name, reason: string, attempts: number }

// ─── Extension loop ──────────────────────────────────────────────────────
| 'extension.tool_needed'  // { concept_id, tool_name }
| 'extension.tool_reused'  // { concept_id, tool_name, tool_id }
| 'extension.tool_blocked' // { concept_id, tool_name, reason: string }

// ─── Researcher ──────────────────────────────────────────────────────────
| 'research.started'       // { concept_id, topic, provider: ResearchSearchProvider }
| 'research.completed'     // { concept_id, topic, source_count: number, artifact_ref: string }
| 'research.failed'        // { concept_id, topic, error: string }

// ─── Critic ──────────────────────────────────────────────────────────────
| 'critique.started'       // { concept_id, phase: EnginePhase, subject_id: string }
| 'critique.verdict'       // { concept_id, phase: EnginePhase, verdict: 'pass'|'rework'|'block' }

// ─── Strategy ────────────────────────────────────────────────────────────
| 'strategy.set'           // { key, domain?: string }
| 'strategy.deleted'       // { key }
```

Corresponding discriminated-union interfaces follow the same pattern as existing event shapes (extend `EventBase`, add `type` discriminant plus payload fields).

---

## F. DurableDag NODE KINDS

New `kind` strings used in Universal Engine DAG nodes (payload fields shown):

| kind | inputs (payload fields) | outputs (provenance links) |
|---|---|---|
| `'ue.plan'` | `concept_id`, `goal`, `context_hash` | `artifact: plan ArtifactRef` |
| `'ue.research'` | `concept_id`, `topic`, `plan_ref` | `artifact: research_source_capture ArtifactRef` |
| `'ue.tool_forge'` | `concept_id`, `tool_name`, `kind`, `acceptance_criteria[]` | `artifact: tool_source ArtifactRef`, `tool_id` |
| `'ue.execute'` | `concept_id`, `plan_ref`, `tool_ids[]`, `research_refs[]` | `artifact: execution_result ArtifactRef` |
| `'ue.critique'` | `concept_id`, `phase`, `subject_artifact_ref` | `artifact: critique_report ArtifactRef` |
| `'ue.memory_persist'` | `concept_id`, `run_id`, `artifact_refs[]` | `memory_entry_ids[]` |
| `'ue.sandbox_run'` | `tool_id`, `args`, `backend` | `artifact: sandbox_result ArtifactRef` |

---

## G. ArtifactStore ARTIFACT KINDS

Add to `ArtifactKind` union in `runtime/artifact-model.ts`:

| kind | content type | retention |
|---|---|---|
| `'plan_document'` | `application/json` | permanent |
| `'research_result'` | `application/json` | 90 days |
| `'tool_source'` | `text/plain` (markdown/code) | permanent |
| `'sandbox_result'` | `application/json` | 30 days |
| `'critique_report'` | `application/json` | 90 days |
| `'execution_result'` | `application/json` | permanent |
| `'strategy_snapshot'` | `application/json` | permanent |
| `'concept_trace'` | `application/json` | 90 days |

---

## H. ToolRegistry Schema

```typescript
// packages/engine/src/runtime/universal/tool-registry.ts

export type ToolKind = 'script' | 'api_client' | 'mcp_tool' | 'wasm_module';

export type ToolStatus = 'active' | 'retired' | 'pending_validation';

export interface ToolCapability {
  /** Terse description of what the tool does */
  description: string;
  /** Trigger phrases / keywords the Planner uses to detect tool need */
  triggers: string[];
  /** JSON Schema for the tool's input */
  inputSchema: Record<string, unknown>;
  /** JSON Schema for the tool's output */
  outputSchema: Record<string, unknown>;
}

export interface ToolTestResult {
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  sandboxBackend: SandboxBackend;
  testedAt: string;
}

export interface RegistryEntry {
  /** UUID v4 */
  id: string;
  /** Slugified tool name, unique within the registry */
  name: string;
  kind: ToolKind;
  status: ToolStatus;
  capability: ToolCapability;
  /** Absolute path to the implementation file on disk */
  implPath: string;
  /** SHA-256 of the implementation file content */
  contentHash: string;
  /** ArtifactRef.id of the 'tool_source' artifact */
  artifactId: string;
  /** ArtifactRef.id of the last passing 'sandbox_result' artifact */
  lastTestArtifactId?: string;
  lastTestResult?: ToolTestResult;
  /** concept_id that originally forged this tool */
  forgedByConceptId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
  tags: string[];
}

export interface ToolRegistryQuery {
  kind?: ToolKind;
  status?: ToolStatus;
  tags?: string[];
  /** Full-text match against name + capability.description + capability.triggers */
  q?: string;
}

export interface ToolRegistry {
  register(entry: Omit<RegistryEntry, 'id' | 'createdAt' | 'updatedAt' | 'version'>): RegistryEntry;
  find(query: ToolRegistryQuery): RegistryEntry[];
  get(id: string): RegistryEntry | undefined;
  getByName(name: string): RegistryEntry | undefined;
  retire(id: string): boolean;
  loadAll(): RegistryEntry[];
}
```

---

## I. Sandbox Executor Interface

```typescript
// packages/engine/src/runtime/universal/sandbox-executor.ts

export type SandboxBackend = 'local-process' | 'docker' | 'wasm';

export interface SandboxRunOptions {
  /** Absolute path to the tool implementation script/module */
  implPath: string;
  /** Serialisable arguments passed to the tool as stdin JSON */
  args: Record<string, unknown>;
  /** Working directory for the child process (must be isolated) */
  workdir: string;
  /** Wall-clock timeout in milliseconds. Default: 30_000 */
  timeoutMs?: number;
  /** Max stdout bytes to capture. Default: 1_048_576 (1 MB) */
  maxOutputBytes?: number;
  /** Environment variables injected into the sandbox (allowlist only) */
  env?: Record<string, string>;
  /** If true, the sandbox may make outbound HTTP requests. Default: false */
  networkEnabled?: boolean;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  backend: SandboxBackend;
  /** ArtifactRef id of the 'sandbox_result' written by the executor */
  artifactId: string;
}

export interface ISandboxExecutor {
  readonly backend: SandboxBackend;
  /** Returns true if this backend is available in the current environment */
  isAvailable(): Promise<boolean>;
  /** Execute the tool and return a result */
  run(opts: SandboxRunOptions): Promise<SandboxResult>;
}

/** Factory: returns the most-capable available backend. */
export interface SandboxExecutorFactory {
  (preferredBackend?: SandboxBackend): Promise<ISandboxExecutor>;
}
```

**Backend implementations:**

- `LocalProcessBackend` (`sandbox-executor.ts` default export section) — uses `node:child_process` `spawn()` with `cwd` isolation, `SIGKILL` on timeout, stdout/stderr capture via streams.
- `DockerBackend` (`packages/sandbox/src/docker-backend.ts`) — wraps `dockerode` container create/start/wait/remove. Image configurable via `PYRFOR_SANDBOX_IMAGE` env var. Network disabled by default via `--network none`.
- `WasmBackend` (`packages/sandbox/src/wasm-backend.ts`) — loads `.wasm` via `@assemblyscript/loader`; in-process, zero-spawn overhead, extremely limited I/O.

---

## J. CLI COMMANDS

Add to `packages/engine/src/runtime/cli.ts` and in `packages/cli/src/commands/`:

```
pyrfor concept "<goal>"
  [--workspace <path>]        Override workspace root
  [--dry-run]                 Plan only, no execution
  [--strategy "<key=value>"]  Inject one-shot strategy hint
  [--budget-usd <n>]          Cap total spend
  [--model <model>]           Override LLM model
  Starts a full end-to-end concept run. Streams phase events to stdout.

pyrfor plan "<goal>"
  [--workspace <path>]
  [--json]                    Output PlanDocument as JSON
  Runs only the Planner phase; prints the plan and exits.

pyrfor run <conceptId>
  [--phase <phase>]           Resume from a specific phase
  [--force]                   Re-run even if already completed
  Resumes or replays a concept run from disk state.

pyrfor tool forge "<name>" --description "<desc>" --kind <script|api_client|mcp_tool|wasm_module>
pyrfor tool list [--kind <kind>] [--q <search>]
pyrfor tool retire <toolId>
pyrfor tool test <toolId>
  Manually trigger sandbox test of a registered tool.

pyrfor status [<conceptId>]
  Without conceptId: list all active concepts.
  With conceptId: stream live phase progress via SSE from gateway.
```

---

## K. VS CODE EXTENSION SURFACE

Additions to any existing `packages/desktop` or VS Code extension (create `packages/vscode-extension/` if none exists):

```
Commands (command palette):
  pyrfor.concept.start     "Pyrfor: Start Concept"      → input box → POST /api/concepts
  pyrfor.concept.status    "Pyrfor: View Concept Status" → open status webview
  pyrfor.tool.list         "Pyrfor: Browse Tool Registry" → open tree view
  pyrfor.strategy.set      "Pyrfor: Set Strategy"        → input key + value → POST /api/strategy
  pyrfor.plan.preview      "Pyrfor: Preview Plan"        → opens PlanDocument in editor

Views (activity bar panel):
  "Pyrfor" side bar:
    ConceptsTreeView        — live list of concepts with phase status badges
    ToolRegistryTreeView    — list of registered tools, grouped by kind
    StrategyView            — list of active strategy entries

Status bar item:
  "Pyrfor: phase [execute] ●" — shows active concept's current phase; click → ConceptsTreeView

Webview panel:
  ConceptTraceView          — renders concept_trace artifact as a Mermaid flow diagram
                             (reuses existing `runtime/dashboard-ui.ts` SSE subscription)

Editor context menu (when file is open):
  "Pyrfor: Use this file as context for concept" → attaches current file as context to new concept input
```

---

## L. TEST PLAN

### Existing tests to extend

| File | What to add |
|---|---|
| `runtime/__tests__/pyrfor-fc-plan-act.test.ts` | Add cases where Planner returns `missingTools`; assert `tool_forge.started` events appear. |
| `runtime/__tests__/pyrfor-fc-quest.test.ts` | Add a concept-level quest that spans plan + execute phases; assert concept events in ledger. |
| `runtime/event-ledger.test.ts` | Add round-trip tests for every new `LedgerEventType` (parse → serialise → parse). |
| `runtime/durable-dag.test.ts` | Add tests for new `ue.*` node kinds via `addNode({ kind: 'ue.plan', ... })`; assert provenance links. |
| `runtime/artifact-model.test.ts` | Add tests for all new `ArtifactKind` literals including `contentType` metadata storage. |
| `runtime/approval-flow.test.ts` | Add test that `concept_id` and `engine_phase` flow through approval requests. |
| `runtime/guardrails.test.ts` | Add `sandbox` tier tests; assert deny for tier > configured autonomousMaxTier. |
| `runtime/verifier-lane.test.ts` | Add multi-phase concept verification with `conceptId` grouping. |
| `evals/agent-evals.test.ts` | Add concept-level eval: mock planner + mock executor, assert critic verdict is `pass`. |

### New test files to add

| File | Coverage |
|---|---|
| `runtime/universal/engine-loop.test.ts` | Happy path: plan→execute→critique→done. Abort mid-phase. Resume from disk (DAG re-hydration). Budget exhaustion → concept.failed. |
| `runtime/universal/planner.test.ts` | Known concept → deterministic PlanDocument shape. Idempotency: same concept + context_hash returns cached artifact. Missing tools populated correctly. |
| `runtime/universal/researcher.test.ts` | Research happy path with mock search provider. Offline fallback to LLM grounding. Approval-required path: assert `approval.requested` event. |
| `runtime/universal/tool-forge.test.ts` | Forge success on attempt 1. Forge failure → retry → success on attempt 2. Exhausted retries → `tool.forge.failed` event. Idempotency: re-forge of existing `contentHash` returns existing entry. |
| `runtime/universal/tool-registry.test.ts` | Register, find by kind, find by q, retire, dedup by contentHash, persist/reload across process restart. |
| `runtime/universal/sandbox-executor.test.ts` | LocalProcessBackend: stdout capture, stderr capture, timeout kill, non-zero exit code. Docker backend: skip if Docker unavailable. WASM backend: in-process execution stub. |
| `runtime/universal/critic.test.ts` | Pass verdict: no rework. Rework verdict: engine loop re-queues DAG node. Max rework cycles respected (does not loop forever). |
| `runtime/universal/memory-facade.test.ts` | remember/recall round-trip. consolidate() after run extracts facts into MemoryStore. |
| `runtime/universal/strategy-store.test.ts` | set, get, list, delete strategies. Strategies injected into Planner prompt. |
| `runtime/universal/self-extension-loop.test.ts` | All tools available → no forge triggered. One missing tool → forge called once. Forge blocked → `extension.tool_blocked` event + DAG node blocked. |
| `runtime/universal/concept-store.test.ts` | create, update, list, get concept records. JSONL persistence and reload. |
| `runtime/__tests__/gateway-concepts.test.ts` | All new `/api/concepts`, `/api/tools`, `/api/strategy` routes: happy path + 400/404 cases. |
| `evals/universal-engine-evals.ts` | Full deterministic eval suite (see section B). |

---

## M. MIGRATION PLAN

### Principle
All new Universal Engine code lives exclusively under `runtime/universal/`. The existing FreeClaude execution path (`pyrfor-fc-adapter.ts`, `pyrfor-fc-circuit-router.ts`, `pyrfor-fc-supervisor.ts`, `freeclaude-mode.ts`) is **not modified** in M1–M3. Consumers of `PyrforRuntime` and `GatewayDeps` are not broken because all additions are optional properties.

### Step-by-step

**Step 0 — type extension, no runtime change**
- Add new `LedgerEventType` literals and interfaces (no existing event shapes removed or renamed).
- Add new `ArtifactKind` literals (existing kinds unchanged; `ARTIFACT_KINDS` set is a superset).
- Add `RunMode = 'universal'` (existing mode strings unchanged).
- Add `MemoryKind = 'strategy' | 'tool_result'` (existing kinds unchanged).
- All changes are backwards-compatible: existing `switch/case` and discriminated-union exhaustiveness checks still compile because new variants are additive.

**Step 1 — new files, no wiring**
- Create `runtime/universal/types.ts` and all new modules in `runtime/universal/`.
- Create `packages/sandbox/` and `packages/cli/` with stubs.
- No imports from `gateway.ts` or `runtime/index.ts` yet. All new files compile in isolation.

**Step 2 — wire into gateway behind feature flag**
- Add `universalEngine?: UniversalEngineOrchestrator` to `GatewayDeps` (optional, so all existing gateway consumers compile unchanged).
- Add new route blocks guarded by `if (!deps.universalEngine) { res.writeHead(503); return; }` — existing routes unaffected.
- Add `universalEngine` instantiation to the existing `createRuntimeGateway` factory only when `config.features?.universalEngine === true`.

**Step 3 — wire into PyrforRuntime**
- Add `startUniversalEngine()` / `stopUniversalEngine()` that are no-ops unless `config.features?.universalEngine === true`.
- `dispatchConcept()` on `PyrforRuntime` delegates to `UniversalEngineOrchestrator` or throws `FeatureDisabledError` — existing `handleMessage()` path untouched.

**Step 4 — CLI extension**
- Add new `CLIMode` variants to `cli.ts`. Existing `daemon`, `chat`, `telegram`, `once` modes are unchanged — new modes are additive `if` branches.

**Step 5 — sandbox package**
- `packages/sandbox` wired into `packages/engine` as an optional dynamic import inside `sandbox-executor.ts`. No hard dep added to `engine/package.json`; consumers opt-in via `packages/sandbox` in their own deps.

**Step 6 — enable by default**
- After M4 acceptance criteria pass, flip `config.features.universalEngine` default to `true`.
- Remove feature-flag guards from gateway routes.

### FreeClaude compatibility contract
- `runFreeClaude()`, `FCRunOptions`, `FCHandle`, `FCEnvelope`, `FCEvent`, `FcCircuitRouter`, `FcSupervisor` are **never touched** during M1–M5.
- `UniversalEngineOrchestrator` calls `runFreeClaude()` internally (ToolForge uses it to generate tool implementations) — it is a consumer, not a modifier.
- All existing gateway tests in `runtime/__tests__/` continue to pass at every milestone because they do not use `GatewayDeps.universalEngine`.

---

## N. DEPENDENCY-ORDERED MILESTONES

---

### M1 — Type Foundation
**Files touched / created:**
- `runtime/event-ledger.ts` (new event types)
- `runtime/durable-dag.ts` (no code change — kinds are strings)
- `runtime/artifact-model.ts` (new kinds)
- `runtime/run-lifecycle.ts` (new mode, new record fields)
- `runtime/memory-store.ts` (new kinds)
- `runtime/universal/types.ts` (new file)

**Acceptance criteria:**
- `tsc --noEmit` passes with zero new errors.
- `runtime/event-ledger.test.ts` additions pass (round-trip for all new event types).
- `runtime/artifact-model.test.ts` additions pass.
- No existing test suite regresses.

---

### M2 — Core Primitives (no LLM calls)
**Files created:**
- `runtime/universal/tool-registry.ts`
- `runtime/universal/concept-store.ts`
- `runtime/universal/strategy-store.ts`
- `runtime/universal/memory-facade.ts`

**Files touched:**
- `runtime/memory-store.ts` (strategy kind already added in M1)
- `runtime/guardrails.ts` (sandbox tier)

**Acceptance criteria:**
- `runtime/universal/tool-registry.test.ts` passes (register, find, retire, dedup, persist/reload).
- `runtime/universal/concept-store.test.ts` passes.
- `runtime/universal/strategy-store.test.ts` passes.
- `runtime/universal/memory-facade.test.ts` passes.
- `runtime/guardrails.test.ts` additions pass.

---

### M3 — Sandbox Executor
**Files created:**
- `runtime/universal/sandbox-executor.ts` (LocalProcessBackend inline)
- `packages/sandbox/src/docker-backend.ts`
- `packages/sandbox/src/wasm-backend.ts`
- `packages/sandbox/src/index.ts`
- `packages/sandbox/package.json`, `tsconfig.json`

**Acceptance criteria:**
- `runtime/universal/sandbox-executor.test.ts` passes (LocalProcess backend; Docker tests skipped if daemon absent).
- `packages/sandbox` builds clean.
- No engine package.json dependency on `dockerode` (dynamic import only).

---

### M4 — ToolForge + Self-Extension Loop
**Files created:**
- `runtime/universal/tool-forge.ts`
- `runtime/universal/self-extension-loop.ts`

**Files touched:**
- `runtime/pyrfor-fc-skill-writer.ts` (version, toolKind fields)
- `runtime/pyrfor-pattern-to-skill.ts` (toolKind propagation)
- `runtime/event-ledger.ts` (tool.forge.* and extension.* events already added in M1)

**Acceptance criteria:**
- `runtime/universal/tool-forge.test.ts` passes (happy path, retry, exhaustion, idempotency).
- `runtime/universal/self-extension-loop.test.ts` passes.
- `runtime/pyrfor-fc-skill-writer.ts` existing tests still pass.

---

### M5 — Planner + Researcher
**Files created:**
- `runtime/universal/planner.ts`
- `runtime/universal/researcher.ts`

**Files touched:**
- `ai/orchestration/planner.ts` (buildUniversalPlan export)
- `runtime/research-search.ts` (no structural change, research.* events emitted by researcher.ts)
- `runtime/approval-flow.ts` (concept_id, engine_phase fields already added in M1)

**Acceptance criteria:**
- `runtime/universal/planner.test.ts` passes (deterministic plan, idempotency).
- `runtime/universal/researcher.test.ts` passes (mock provider, offline fallback, approval path).
- `ai/orchestration/planner.ts` existing test still passes.

---

### M6 — Critic
**Files created:**
- `runtime/universal/critic.ts`

**Files touched:**
- `runtime/verifier-lane.ts` (conceptId, phaseResults already added in M1)
- `ai/orchestration/reflection.ts` (phaseId, phaseCritique fields)

**Acceptance criteria:**
- `runtime/universal/critic.test.ts` passes (pass, rework, block verdicts; max cycles).
- `runtime/verifier-lane.test.ts` additions pass.

---

### M7 — Engine Loop (Main Loop)
**Files created:**
- `runtime/universal/engine-loop.ts`
- `runtime/universal/index.ts`

**Files touched:**
- `runtime/index.ts` (universalEngine property, startUniversalEngine/stopUniversalEngine, dispatchConcept)
- `runtime/token-budget-controller.ts` (concept scope, phaseId field)

**Acceptance criteria:**
- `runtime/universal/engine-loop.test.ts` passes (happy path end-to-end with mocked planner/researcher/toolforge/executor/critic).
- Budget exhaustion → `concept.failed` ledger event.
- Abort → `concept.aborted` ledger event.
- DAG re-hydration from disk → concept resumes correctly.

---

### M8 — Gateway Integration
**Files touched:**
- `runtime/gateway.ts` (all new `/api/concepts`, `/api/tools`, `/api/strategy`, `/api/memory/universal` routes)
- `runtime/run-lifecycle.ts` (run mode `'universal'` already added in M1)

**Files created:**
- `runtime/__tests__/gateway-concepts.test.ts`

**Acceptance criteria:**
- All new gateway routes return correct shapes (unit tests with test gateway instance).
- All existing gateway tests pass unchanged.
- Feature-flag guard: routes return 503 when `universalEngine` is absent from deps.

---

### M9 — CLI Extension
**Files touched:**
- `runtime/cli.ts` (new CLIMode variants and argument parsing)

**Files created:**
- `packages/cli/src/index.ts`
- `packages/cli/src/commands/concept.ts`
- `packages/cli/src/commands/plan.ts`
- `packages/cli/src/commands/run.ts`
- `packages/cli/src/commands/tool.ts`
- `packages/cli/src/commands/status.ts`
- `packages/cli/src/client.ts`
- `packages/cli/package.json`, `tsconfig.json`
- `packages/cli/bin/pyrfor`

**Acceptance criteria:**
- `pyrfor concept "write a hello world in Go"` starts a concept run and streams phase events.
- `pyrfor plan "..."` exits after printing PlanDocument JSON.
- `pyrfor tool list` prints registered tools.
- Existing `node dist/runtime/cli.js --chat` still works.

---

### M10 — Eval Suite + VS Code Surface
**Files created:**
- `evals/universal-engine-evals.ts`
- `packages/vscode-extension/src/commands/concept.ts` (if extension package exists, else stub)
- `packages/vscode-extension/src/views/concepts-tree.ts`
- `packages/vscode-extension/src/views/tool-registry-tree.ts`

**Acceptance criteria:**
- `evals/universal-engine-evals.ts` passes (all deterministic eval cases).
- VS Code extension compiles and registers commands without error.
- Full `tsc --noEmit` across all packages passes.
- No existing FreeClaude test regresses.
