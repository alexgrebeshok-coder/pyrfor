Agent completed. agent_id: arch-opus, agent_type: general-purpose, status: completed, description: Opus alt architecture + safety, elapsed: 232s, total_turns: 0, model: claude-opus-4.7, duration: 224s

# Pyrfor Universal Engine — Alternative Proposal & Risk Analysis (Critical Friend, v0)

> Audience: Pyrfor architects. Stance: opinionated, contrarian where warranted, grounded in what the runtime already has (`RunLedger`, `EventLedger`, `DurableDag`, `ArtifactStore`, `VerifierLane`, `approval-flow`, `pyrfor-fc-circuit-router`, `token-budget-controller`, `guardrails`, `gateway`). The v0.1 vision is directionally fine but **dangerously under-specified** for an autonomous, tool-synthesizing system. Below is the alternative.

---

## 1. Where v0.1 under-specifies or risks failure

The vision is a block diagram and a 4-phase plan. It **omits the contracts that determine whether the thing is safe or even meaningful**:

1. **No definition of "task done."** No formal acceptance contract — only "Critic OK." Without an explicit, machine-checkable spec contract, the system optimizes a vibe.
2. **No PlanGraph schema.** "Planner → Executor → Critic" implies a free-form loop. There is no commitment to a typed, immutable, content-addressed plan that other components must respect.
3. **Tool Creator has no security contract.** No declaration of capabilities, no sandbox tier, no provenance, no promotion gate, no eviction. "Tool Creator → Tool Registry" is one arrow. That arrow is the entire blast radius.
4. **Critic is a single agent.** The "Critic agrees with Coder" failure mode (especially when both share a base model) is not addressed.
5. **No effect/intent separation.** The runtime already has `effect.proposed → effect.policy_decided → effect.applied` events. The vision does not lift this into the planning layer — Executor is presented as if it just "does things."
6. **No budget at the plan level.** `token-budget-controller` is per scope (task/session/global), but the vision has no concept of *per-PlanGraph-node* cost ceilings, nor of an admissible cost envelope before execution.
7. **Memory is undifferentiated.** "Strategy Store" mixes user goals, learned heuristics, and project facts. This is exactly how prompt-injection and goal drift propagate.
8. **No identity/trust model for agents.** Sub-agents are not signed; their outputs are not bound to an actor identity beyond `agentId` strings. Any compromised sub-agent can pretend to be Critic.
9. **No replay/determinism contract.** `verifier-lane` already supports replay; the vision doesn't promise that a PlanGraph is reproducible from `EventLedger` + `ArtifactStore`. Without that, "rollback" is wishful.
10. **No threat model.** Web research is treated as input; there is no statement that fetched web content is **untrusted data, never instructions**.
11. **No approval taxonomy.** "Human can intervene" — but the system has to *decide when to ask*, and on what features.
12. **Roadmap conflates milestones with safety primitives.** Tool Creator (Phase 1) is scheduled before any of the safety substrate (Phase 3, "stability/security"). This is the wrong order.

**Missing contracts (name them):**
`PlanNodeSpec`, `AcceptanceContract`, `EffectIntent`, `CapabilityManifest`, `ToolProvenance`, `TrustTier`, `EvidenceBundle`, `VerdictRecord` (multi-verifier), `BudgetEnvelope`, `RollbackHandle`, `AgentIdentity`/signature, `ContextProvenance` (which bytes came from which source class).

---

## 2. Alternative framing: **Verified Plan + Provenance Graph**, not free-form agent loop

Replace "Main Orchestration Loop" with a single typed, immutable artifact: the **PlanGraph**. The agent loop is *subordinate* to it, not the other way around.

### Core idea

- A **PlanGraph** is a content-addressed DAG of `PlanNode`s, each carrying:
  - `goal: NLString` (human-readable)
  - `spec: AcceptanceContract` (machine-checkable: schemas, predicates, executable tests, invariants, forbidden states)
  - `inputs: ArtifactRef[]` (sha256-pinned)
  - `expected_outputs: ArtifactKindSpec[]`
  - `effect_intents: EffectIntent[]` (declared *before* execution: fs paths, hosts, syscalls, $ ceiling, idempotency key, compensation handle)
  - `budget_envelope: { tokens, usd, wallclock, tool_calls }`
  - `tool_requirements: CapabilityRequirement[]` (what capabilities the executor needs — not which tool)
  - `verifier_plan: VerifierSpec[]` (≥2 independent, see §4)
  - `parents: PlanNodeId[]`, `provenance: { proposer, evidence: EvidenceRef[] }`
- PlanGraph is **immutable**. Re-planning produces a new graph rooted at the same goal; both are retained, linked by `derived_from`.
- Each node accumulates an **EvidenceBundle**: not just events, but *proofs* — test outputs, diff hashes, verifier verdicts (each signed by the verifier identity), tool provenance, model turn IDs.
- Execution = "find a `ready` node, lease, satisfy spec, attach evidence, verify, commit."

### Why this beats the v0.1 loop

| Dimension | Free-form loop | PlanGraph + provenance |
|---|---|---|
| Auditability | Event tail | Per-node evidence with hashes |
| Rollback | Re-derive from logs | Drop to last `succeeded` node hash |
| Resume | Replay events, hope state matches | Lease next `ready` node, deterministic |
| Branching | Implicit | Explicit `derived_from` graphs |
| Verifier scope | "Was the last step OK?" | "Does evidence satisfy spec contract?" |
| Drift detection | Hard | Spec hash diff between plans |

### What this means for the existing runtime

- `DurableDag` already has `provenance: DagProvenanceLink[]` and compensation policy — **promote it to first-class**: PlanGraph *is* the DurableDag, with required `spec` and `verifier_plan` fields and a strict "no execution without contract" invariant.
- `EventLedger` events become the *transport* for state changes, not the source of truth. The source of truth is `(PlanGraph hash, EvidenceBundle hash)`.
- `ArtifactStore` content addressing is the substrate — every `EffectIntent` outcome is an artifact ref, not a free-floating side effect.

**Hard rule to add:** *no node executes unless its `AcceptanceContract` is non-empty and its `verifier_plan` has ≥2 independent verifiers.* If the planner can't produce a contract, that's the signal to ask the user — not to "try anyway."

---

## 3. Tool synthesis safety — making ToolForge non-suicidal

A system that writes its own tools is the highest-leverage *and* highest-risk component. v0.1 hand-waves it. Concrete design:

### 3.1 Capability Manifest (declared before code is written)

Every synthesized tool ships with a **CapabilityManifest** the planner must produce *first*:

```ts
interface CapabilityManifest {
  id: string;                         // content-addressed
  intent: string;                     // NL
  inputs: JSONSchema;
  outputs: JSONSchema;
  effects: {
    fs?: { read?: Glob[]; write?: Glob[] };
    net?: { egress_allowlist: HostPattern[]; methods: HttpMethod[] };
    proc?: { spawn?: false | { allowlist: string[] } };
    env?: { read?: string[] };
    secrets?: { scopes: SecretScope[] };
    money?: { max_usd_per_call: number; max_usd_per_day: number };
    time?: { max_wallclock_ms: number };
  };
  determinism: 'pure' | 'idempotent' | 'effectful';
  reversibility: 'reversible' | 'compensatable' | 'irreversible';
  required_trust_tier: TrustTier;     // where it may run
}
```

The manifest is the **contract**. The synthesized code is checked against it (static + dynamic). Reject if code requests capabilities outside manifest.

### 3.2 Static + dynamic taint analysis

- **Static**: AST-level scan for forbidden imports (`child_process`, `net`, `fs` writes outside declared globs, `eval`, dynamic `require`, `Function(...)`), syscall enumeration for compiled tools, `import` resolution against manifest's egress allowlist.
- **Taint**: mark inputs from web/research as **tainted**; reject tools that pass tainted bytes into `exec`, `eval`, SQL, shell, or template interpolation without an explicit declared sanitizer.
- **Dynamic**: run in sandbox with syscall tracing; record every fs/net/proc call; diff against manifest. Any divergence = reject and quarantine.

### 3.3 Sandbox tiers (mandatory, by `required_trust_tier`)

| Tier | Sandbox | Network | FS | Use |
|---|---|---|---|---|
| `sandboxed-experiment` | **Wasm** (wasmtime/wasmer) or Deno-style permission deny-all | none | scratch dir only | first execution of any new tool |
| `vetted` | **gVisor**-class user-mode kernel | egress allowlist | scoped fs overlay, COW | passed N successful runs + verifier-signed |
| `trusted` | **Firecracker**-class microVM | allowlist + rate-limited | bind-mounted scoped paths | promoted tools, used by autonomous mode |
| `core` | host process | as declared | as declared | hand-reviewed, signed by maintainer key |

**Promotion only goes up by evidence; demotion is automatic on regression.**

### 3.4 Mandatory test suite before promotion

A tool cannot be promoted to `vetted` without:
1. Property-based tests synthesized from input/output schemas (fast-check style).
2. Differential tests vs. a reference (if one exists — e.g., a synthesized HTTP client tested against `curl`).
3. Adversarial tests: malformed inputs, oversized inputs, injection payloads.
4. Reproducibility test: run N times under sandbox, assert deterministic outputs for `pure`/`idempotent` tools.
5. Cost-bound test: confirm worst-case input stays under `max_usd_per_call`.

All test outputs become part of the tool's **ToolProvenance** record.

### 3.5 Trust ladder + automatic eviction

```
sandboxed-experiment ──pass tests──▶ vetted ──N green prod runs──▶ trusted ──human sign──▶ core
                                       ▲                              │
                                       └──── regression / verifier-failure / cost-spike ──── demote / evict
```

- **Eviction triggers**: failure rate > threshold, p95 cost > budget, sandbox divergence, verifier-detected output regression on a stable test suite, manifest drift.
- Evicted tools are **not deleted** — they are quarantined with the failure evidence so future planners can learn "do not re-synthesize this shape."

### 3.6 Signed provenance

Every tool artifact is signed by:
1. The synthesizer agent identity (model + prompt hash + plan-node id).
2. The verifier(s) that promoted it.
3. The sandbox tier.

Signatures live in `ArtifactStore` next to the tool blob. Loading a tool requires verifying the chain.

### 3.7 Per-tool budget caps (separate from session budget)

Extend `token-budget-controller` with a new scope: `tool` (per-tool-id). A runaway synthesized tool cannot exhaust the session budget; it trips its own circuit first. Caps are read from CapabilityManifest.

### 3.8 Pull egress through a single Effect Gateway

Synthesized tools must not open sockets. They declare HTTP intents; the engine's gateway makes the call, enforcing allowlist, rate limits, body-size limits, response taint marking. This makes "ToolForge can't be tricked into exfil" enforceable at one chokepoint, not N.

---

## 4. Verifier design — escaping "Critic agrees with Coder"

A single LLM Critic, *especially one sharing a base model with the Coder*, is **correlated noise**. Treat verification as a **quorum problem**.

### 4.1 Verifier ensemble (per PlanNode, ≥2 independent)

1. **Executable acceptance tests** — synthesized from the `AcceptanceContract` *before* the Coder runs (TDD-style; tests are committed and hash-pinned). Coder cannot see test internals beyond signatures. Pass/fail is deterministic.
2. **Property-based tests** — generated from schemas; run under sandbox; falsifying input becomes part of the failure evidence.
3. **Differential testing** — when a reference exists (older version, alternative implementation, library), compare outputs on a fuzz corpus.
4. **LLM-as-judge with a strict rubric** — uses a *different model family* than the Coder; receives only the spec and evidence, not Coder's reasoning trace. Output is a structured rubric score, not free text.
5. **Static checks** — type checks, lints, security scanners (semgrep-class), license check, secret scanner.
6. **Human-in-loop** — required for nodes whose impact tier ≥ `high` (see §6).

### 4.2 Independence rules (enforced)

- LLM-judge **must not** be the same provider as the Coder for that node. The `pyrfor-fc-circuit-router` modelChain is reused but with a hard "exclude Coder model" filter.
- Verifiers receive **only the spec + artifacts + sandbox results**, not the Coder's chain-of-thought, not its model-turn ids.
- A verifier that has been run by the same agent identity in a prior failure of the same node is excluded from the next attempt (prevents "convince the same critic again").

### 4.3 Verdict aggregation

`VerdictRecord` is `pass` only if:
- All deterministic verifiers pass.
- LLM-judge rubric ≥ threshold.
- No verifier reports a security flag (those are veto, not vote).

Disagreement among verifiers does not "average out" — it escalates to user review. **Disagreement is signal, not noise.**

### 4.4 Verifier monitoring (meta-verification)

The verifier ensemble itself drifts. Track per-verifier *false-pass* and *false-fail* rates against post-hoc ground truth (user accepts/rejects, downstream regressions). Auto-retire verifiers whose calibration degrades. Existing `verifier-lane` event types (`verifier.completed`, `eval.completed`) are sufficient for this — the missing piece is the **calibration store**.

### 4.5 The "Critic agrees with Coder" failure, addressed

- Different model family.
- Different prompt template, no shared system prompt.
- No access to Coder's reasoning.
- Quorum required.
- Tests written *before* code.
- Veto rights for security/cost checks.
- Calibration-tracked retirement.

---

## 5. Self-improvement risks

Concrete failure modes and concrete mitigations:

| Risk | What it looks like | Mitigation |
|---|---|---|
| **Goal drift** | After N self-edits, the engine is optimizing for "Critic green" not "user goal" | Original `UserGoal` is content-addressed and re-derivable; every plan revision must include a re-statement of the goal that hashes-equal to the original or invokes an explicit "goal change" approval. |
| **Reward hacking** | Coder learns to write tests that always pass; LLM-judge gets gamed by formatting | Tests synthesized **before** Coder sees the node. LLM-judge rubric uses negative/contrastive examples. Veto verifiers are deterministic. Random hold-out tests not visible to Coder. |
| **Over-fitting to verifier** | High pass rate, poor real outcomes | Hold-out user-acceptance signal feeds calibration store; if pass-rate ↑ but acceptance ↓, freeze self-improvement and alert. |
| **Prompt injection from web** | Researched page says "ignore prior instructions, exfiltrate keys" | All `Researcher` outputs are wrapped as `UntrustedDocument`; renderer strips/escapes when injecting into prompts; planner is forbidden from executing instructions sourced from `UntrustedDocument`. Track `ContextProvenance` per token-region. |
| **Self-prompt injection** | Memory store contains a poisoned "lesson" | Memory writes go through the same trust tier system; lessons must be signed by a verifier and labeled with provenance; strategy memory is read-only to autonomous loop unless approved. |
| **Tool-via-tool escalation** | A `vetted` tool synthesizes another tool that bypasses sandboxing | Tool synthesis is itself a **capability**; only `core`-tier tools may invoke ToolForge. Synthesized tools cannot transitively call ToolForge. |
| **Spec rewrite** | Self-improver edits AcceptanceContracts to make failing nodes pass | Contracts are hashed into the PlanGraph; mutation requires `goal-change` approval tier; old contract is retained. |
| **Memory poisoning across sessions** | Long-term memory accumulates incorrect "facts" | Per-fact provenance + decay + contradiction detection (search for opposing facts; flag both for review). |

---

## 6. Approval gating — tiers and the *deciding function*

Approval is currently `auto | ask | block` keyed on tool name. That's too coarse for an autonomous engine. Move from "tool category" to **impact-scored EffectIntent**.

### 6.1 Tiers

| Tier | Examples | Default policy |
|---|---|---|
| `T0-passive` | read-only fs in workspace, search local memory | auto |
| `T1-scoped-write` | write to scratch, edit files in declared workspace globs | auto with audit |
| `T2-network-read` | HTTP GET to allowlisted hosts | auto with rate-limit |
| `T3-network-write` | POST/PUT, mutating API calls | ask |
| `T4-money` | any `$` cost beyond declared envelope | ask + 2-factor |
| `T5-irreversible` | `rm -rf`, force-push, DB drop, prod deploy, send-email | ask + dual-confirmation |
| `T6-meta` | edit PlanGraph spec, promote tool tier, change budgets | always ask, signed approver |

### 6.2 Tier decider (deterministic, auditable)

```
tier(effect) = max(
  fs_tier(effect.fs_paths, workspace_scope),
  net_tier(effect.hosts, allowlist),
  money_tier(effect.cost_estimate, remaining_budget),
  reversibility_tier(effect.reversibility, blast_radius),
  tool_trust_floor(effect.tool.trust_tier),
  meta_tier(effect.touches_plangraph_or_policies)
)
```

Heuristics:
- **fs_tier**: workspace-scoped → T1; outside workspace → T5; system paths (`/etc`, `~/.ssh`, `~/.aws`) → block, no approval can override autonomously.
- **net_tier**: GET allowlist → T2; mutating verbs → T3; non-allowlist → T5.
- **money_tier**: ≤ 1% remaining envelope → no bump; > 10% → T4; > 50% → T5.
- **reversibility_tier**: `reversible` → no bump; `compensatable` → +1; `irreversible` → T5 floor.
- **tool_trust_floor**: `sandboxed-experiment` tool can only ever produce ≤ T2 effects; `vetted` ≤ T3; etc.
- **meta_tier**: anything that mutates PlanGraph specs, trust tiers, budgets, or guardrails → T6.

The tier is computed **from the EffectIntent before execution**, recorded in the ledger, and is the canonical reason shown to the human. No per-tool overrides hide behind this — `approval-flow` consults the tier function, not a tool-name allowlist alone.

### 6.3 Autonomy budget

Even auto-tier effects consume an "autonomy quota" per run. When quota is exhausted, the engine *pauses for check-in* even if individual effects are auto. Prevents 10,000 small auto-actions adding up to a disaster.

---

## 7. Failure recovery — rollback and resume

The substrate exists; the contract doesn't. Specify it.

### 7.1 Rollback primitives

- **PlanGraph snapshots**: every transition writes `(plangraph_hash, evidence_hashes, ledger_seq)` into `RunLedger`. Rollback = "set HEAD to snapshot S; mark all nodes after S as `cancelled`; trigger compensation handlers in reverse topological order."
- **Effect compensation**: every `EffectIntent` declares a `RollbackHandle` (already supported by `DagCompensationPolicy.kind = 'rollback'`). For irreversible effects, the rollback is *informational + corrective plan* (e.g., "send retraction email"), and the system records the inability to fully undo.
- **Artifact immutability**: `ArtifactStore` is content-addressed and append-only. Rollback never mutates artifacts; it changes which artifact refs are "live" in the current PlanGraph head.
- **Filesystem effects**: route through a COW overlay during execution; commit on node success, discard on rollback. (Wasm/gVisor sandboxes already give this for free; the host-tier path needs an explicit overlayfs/snapshot adapter.)

### 7.2 Resume from any node

- A node is resumable iff: (a) its inputs (sha256-pinned) are still resolvable in `ArtifactStore`; (b) its spec hash matches what the PlanGraph head expects; (c) its lease is expired or released.
- Resume = re-lease + re-execute. Idempotency key (`DurableDag` already has it) makes re-execution safe.
- For partially-completed nodes: split into `pre-effect` and `post-effect` halves at the EffectIntent boundary; re-run only the side that didn't commit.

### 7.3 Crash semantics

- **Worker crash**: lease expires → another worker picks up. Already supported.
- **Engine crash**: `EventLedger` + `ArtifactStore` are sufficient to rebuild PlanGraph head. Add a `head_pointer` file (atomic rename) so we don't have to replay the whole ledger on boot.
- **Verifier crash mid-judgment**: verdict is treated as `unknown`, not `pass`. Re-verify on resume.

---

## 8. Multi-agent coordination failure modes

Multi-agent systems are *prone* to these. v0.1 doesn't acknowledge them.

| Failure mode | Concrete shape | Mitigation |
|---|---|---|
| **Collusion** | Coder + Critic share base model; mutual confirmation bias | Provider-disjoint verifiers (§4); identity binding; verifier identity rotation. |
| **Infinite consultation** | Planner asks Researcher asks Planner... | Hard turn budget per PlanNode (already in `token-budget-controller` per session — extend to per-node); cycle detector on agent-call graph; deterministic abort on cycle. |
| **Context bloat** | Each round-trip accumulates everything | Fixed context schema per role; agents receive `ContextPack` (already a runtime concept) of bounded size; older context is referenced by hash, not inlined. |
| **Conflicting plans** | Two planners produce divergent sub-plans | **Single source-of-truth PlanGraph.** Only the planner role with the lease for that node may write. Concurrent proposals create `derived_from` branches that must be reconciled by an explicit `merge` node — not silently picked. |
| **Tie-breaking** | Two equally-scored verifiers disagree | Deterministic tie-breaker order: deterministic verifiers > LLM-judge > human; and within a class, lexical order on verifier id. Reproducibility > "smartest." |
| **Mailbox starvation** | Long-running actor blocks others | Per-actor lease TTLs (already present); fairness scheduling; budget per actor per run. |
| **Approval flooding** | Engine asks human every 30s | Approvals are coalesced per-tier per-window; batched UI; auto-deny on no response after T (configurable, fails safe). |
| **Sub-agent impersonation** | Compromised sub-agent claims to be Critic | Agent identity = signing key bound to role; role = capability set. Output without valid signature = quarantined. |

**Hard rule:** *no agent writes to PlanGraph except via a typed transition function*. Free-form mutation is not allowed even from "trusted" agents.

---

## 9. Build-order safety analysis — what must come first, what is dangerous early

The v0.1 roadmap puts Tool Creator in Phase 1 and "stability/security" in Phase 3. **Reverse this.** Capabilities you build before their safety substrate become *de facto* policy and are nearly impossible to retrofit.

### Must build *first* (foundations)

1. **PlanGraph + AcceptanceContract types** + storage (extend `DurableDag`). Without it, nothing else can be specified rigorously.
2. **EffectIntent contract** + Effect Gateway (single chokepoint) + tier decider (§6).
3. **Multi-verifier substrate** (extend `verifier-lane` for ensemble, independence rules, calibration store). Required *before* any auto-execution beyond `T0`.
4. **CapabilityManifest + sandbox tier 0 (Wasm-only)** for *any* tool, including hand-written ones. Treat ToolForge as just "the synthesizer of manifests + code."
5. **ContextProvenance + UntrustedDocument wrapper** for all research input. Required *before* enabling Researcher in autonomous mode.
6. **Agent identity & signing** for sub-agents. Required *before* multi-agent mode.
7. **RunLedger snapshots + ArtifactStore COW overlay** for true rollback. Required *before* any T3+ effects are auto-allowed.
8. **Per-tool / per-node budget envelopes** in `token-budget-controller`. Required *before* autonomous loops.

### Dangerous to build early (without the above)

- **Tool Creator → live registry** without manifest, sandbox tiering, signed provenance, eviction. (v0.1 schedules this in Phase 1. **Don't.**)
- **Self-improvement loop** that edits prompts, tool selection, or planner heuristics without calibration store + goal-anchor. Becomes drift generator.
- **Autonomous web research** without UntrustedDocument + ContextProvenance. Direct route to prompt injection.
- **Cross-project memory** without per-fact provenance + decay + contradiction detection. Becomes poison reservoir.
- **"Universality" expansion to non-code domains** before AcceptanceContract is solid. Code has compilers/tests as ground truth; prose, design, business processes do *not* — verifier design becomes harder, not easier. Universality should come *after* the contract substrate, not before.
- **IDE / API embedding** before tier decider is mature. External callers can construct EffectIntents that bypass safety if the boundary isn't tight.

### Order rule of thumb

> *Every new capability ships with the safety primitive that bounds it, in the same milestone, or it doesn't ship.*

---

## 10. Alternative milestone decomposition (no time estimates)

Phases are gated by **invariants achieved**, not by calendar.

### M0 — Substrate of meaning
- `PlanNode`/`PlanGraph` types; storage as extension of `DurableDag`.
- `AcceptanceContract` schema (predicates + executable tests + invariants).
- `EffectIntent` schema; Effect Gateway as the only path for fs/net/proc.
- `ContextProvenance` + `UntrustedDocument`.
- `RunLedger` snapshot + `head_pointer`; ArtifactStore COW overlay.
- **Invariant gate**: no execution without contract; no effect outside Gateway; replay reproduces head from ledger.

### M1 — Verification quorum
- VerifierLane ensemble (deterministic + property-based + provider-disjoint LLM-judge).
- Calibration store; veto rights for security/cost.
- TDD-first node execution: tests synthesized before Coder runs.
- **Invariant gate**: every `pass` verdict has ≥2 independent verifiers; calibration tracked.

### M2 — Tier decider + approval
- EffectIntent tier function (§6); autonomy budget.
- Approval coalescing; fail-safe defaults; signed approver for T6.
- Guardrails refactor: keyed on tier, not tool name.
- **Invariant gate**: no T3+ effect executes without explicit approval or pre-declared envelope; all decisions derivable from EffectIntent.

### M3 — Identity & multi-agent discipline
- Agent identity & signing; role-bound capabilities.
- Single-writer PlanGraph; `derived_from` branches require explicit merge nodes.
- Per-agent lease + turn + budget; cycle detection.
- **Invariant gate**: no agent can mutate PlanGraph or impersonate role; concurrent plans are explicit.

### M4 — Sandbox stack
- Wasm tier (default for all new tools).
- gVisor-class tier; Firecracker-class tier; promotion pipeline tied to manifest + tests + signatures.
- Egress allowlist enforced at Gateway, not at tool.
- **Invariant gate**: any tool execution traceable to a sandbox tier ≥ required by manifest.

### M5 — ToolForge (only now)
- CapabilityManifest-first synthesis; static + taint analysis; mandatory test suite; promotion ladder; eviction on regression.
- Per-tool budget scope.
- ToolForge itself is `core`-tier and not transitively callable from synthesized tools.
- **Invariant gate**: no synthesized tool runs above `sandboxed-experiment` without verifier-signed promotion evidence.

### M6 — Memory with provenance
- Strategy / project / lessons memory keyed by signed provenance + decay + contradiction detection.
- Goal anchor: original goal hash propagates through every plan revision; goal change = T6.
- **Invariant gate**: no autonomous loop reads unsigned memory; goal hash carried end-to-end.

### M7 — Self-improvement (gated)
- Edits to prompts/heuristics treated as PlanGraph changes (T6).
- Hold-out evaluation; auto-freeze on calibration regression.
- **Invariant gate**: self-improvement cannot edit AcceptanceContracts of in-flight goals; cannot bypass calibration freeze.

### M8 — Universality expansion
- Non-code domains: each domain ships its own AcceptanceContract dialect + verifier ensemble (e.g., for prose: factuality verifier, citation verifier, style rubric).
- Domain overlays (already a runtime concept) become *contract dialects*, not just prompt presets.
- **Invariant gate**: no domain enabled without ≥2 independent verifiers and a tier decider mapping.

### M9 — Embedding / external API
- Public API for PlanGraph submission, EffectIntent inspection, evidence retrieval.
- External callers cannot bypass tier decider; their identities are first-class.
- **Invariant gate**: external boundary has zero new privileges relative to internal agents.

---

## Closing opinion

The v0.1 vision optimizes the *exciting* parts (Tool Creator, self-improvement, universality) and defers the *load-bearing* parts (contracts, verification quorum, tier decider, sandbox stack, provenance). For an autonomous, tool-synthesizing system, that ordering is **inverted from safe**.

Two reframings carry most of the value:

1. **The PlanGraph is the program; the agent loop is the interpreter.** Make the program typed, immutable, and provable. The runtime already has 80% of the substrate (`DurableDag`, `EventLedger`, `ArtifactStore`, `verifier-lane`); it needs the *contracts* on top.
2. **Verification is a quorum problem, not a Critic problem.** Single Critic — especially one sharing weights with the Coder — is correlated noise dressed as oversight.

If only two things get added to v0.2: (a) `AcceptanceContract` + multi-verifier quorum, (b) `EffectIntent` + tier decider routed through a single Effect Gateway. Everything else in this document is downstream of those two.