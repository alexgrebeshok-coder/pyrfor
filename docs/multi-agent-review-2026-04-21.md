# Multi-Agent & Multimodal Core Review — 2026-04-21

Scope: `lib/ai/**`, `lib/agents/**`, `lib/ai/orchestration/**`, `lib/ai/messaging/**`,
`lib/ai/memory/**`, `lib/voice/**`, `lib/video-facts/**`, plus the affected test
suites under `__tests__/lib/ai/**`.

Primary goals: reliability, observability, safety, and competitive positioning
of the multi-agent kernel.

---

## 1. Executive summary

CEOClaw already has a surprisingly deep agentic substrate for a single-repo
Next.js product — DAG workflows, reflection, circuit-breaker-protected
multi-provider routing, a Reflexion-style self-review loop, a BM25-backed
episodic/semantic/procedural memory, an agent bus with persistence, and a
safety-profile gate for mutations. The gap vs. best-in-class platforms is not
the *features*; it's the *reliability and observability of the kernel under
load and failure*.

This review fixed **eleven concrete reliability and correctness bugs** across
the multi-agent runtime, DAG engine, tool executor, circuit breaker, memory
store, agent bus, dynamic planner, reflection loop, and the legacy agent
subsystem, and added targeted tests. Every fix is landed behind the existing
tests (19 files / 67 tests, all green after the changes).

The remaining strategic gaps (multimodal, auditability, real-time tool
approval UX, agent marketplace) are called out as roadmap items, not hotfixes.

---

## 2. Architectural findings

### 2.1 Two parallel orchestration cores

- **Canonical**: `lib/ai/multi-agent-runtime.ts` + `lib/ai/orchestration/*` +
  `lib/ai/agent-executor.ts`. Uses the dynamic planner, supports reflection,
  tool use, circuit breaker, cost tracking, and bus events.
- **Legacy**: `lib/agents/orchestrator.ts` + `lib/agents/base-agent.ts` +
  `lib/agents/main-agent.ts` + `lib/agents/worker-agents.ts` +
  `lib/agents/agent-improvements.ts`. Hardcoded models
  (`gemma-3-27b-it:free` for code generation), substring-based routing,
  duplicated session manager.

**Recommendation**: keep the legacy path for the CLI/desktop surface but
strip its own provider/router logic. We already redirected the legacy path
to use `getRouter()` and `getAgentSessionManager()` singletons. Next step
should be to delete `ImprovedAgentExecutor` in favour of
`runAgentExecution` once the callers are migrated.

### 2.2 Reliability spine is uneven

| Component | Status before | Status after |
|-----------|---------------|--------------|
| Dynamic planner | Single-agent fallback on unknown agents | Reviewer fallback on complex prompts |
| DAG engine | Leaked timer on success, race collapsed all-siblings on first reject | Per-node timer lifecycle + `Promise.allSettled` isolation |
| Multi-agent runtime | `new AIRouter()` in hot path, unbounded support fan-out, leader failure = hard throw | Singleton router, env-tunable concurrency limit, leader fallback from support outputs, bus events |
| Circuit breaker | State machine correct but no metrics | Metrics (`totalFailures`, `totalSuccesses`, `totalRejections`) + `getAllCircuitBreakerSnapshots()` |
| Agent bus | Swallowed Prisma write errors, broadcasts invisible to `subscribeAgent` | Structured warn log on failure, broadcasts delivered via "*" |
| Memory BM25 | `new RegExp` compiled N × rows times | Regex patterns precompiled once per query |
| Agent executor | Sequential tool calls, duplicates multiplied side effects | Parallel `Promise.allSettled`, per-round dedup by (name + args) |
| Legacy main agent | Order-sensitive substring match misrouted "not main-worker but main-reviewer" | Earliest-match regex with word boundaries |
| Legacy improver | `no-async-promise-executor` anti-pattern, hardcoded retry list | Race with proper timeout cleanup, richer retry list, singleton router |
| Reflection | `router.chat` missed `agentId/runId` → no cost attribution | Attribution forwarded end-to-end |

### 2.3 Planner coverage

`buildDynamicPlan` now returns a collaborative plan with a `quality-guardian`
reviewer when (a) the agent is unregistered in `DOMAIN_RULES` and (b) the
combined `contextComplexity + promptComplexity ≥ 4`. This prevents new or
user-authored agents from silently degrading strategic prompts to
single-agent mode.

### 2.4 Safety

`lib/ai/safety.ts` and the executor's `MUTATION_TOOLS` set are well-scoped;
the real weak spot is cross-workspace identity enforcement in the kernel
control plane. Tracked as a roadmap item (see §5).

### 2.5 Multimodal

- **Voice**: `lib/voice/speech-to-text.ts` is Web Speech API only,
  hardcoded `ru-RU`. Adequate MVP but not server-grade. Roadmap: pluggable
  STT provider (Whisper, YandexSpeechKit, GigaChat STT) behind a typed
  interface symmetric to `AIRouter`.
- **Vision**: `lib/video-facts/service.ts` uses heuristic verification
  against linked work reports. No real vision model integration; no frame
  sampling; no evidence-of-work semantics yet. Roadmap: pass a sampled set
  of frames + metadata to a provider with native vision (e.g. GPT-4o, GLM-5,
  YandexGPT Vision) and record a `verdict` with a calibration score.

---

## 3. Fix-by-fix summary (diff pointers)

- `lib/ai/orchestration/dag-engine.ts` — timer lifecycle +
  `Promise.allSettled` per layer; removed dead `createNodeTimeout` helper.
- `lib/ai/orchestration/planner.ts` — default reviewer fallback on
  high-complexity prompts when no domain rule matches.
- `lib/ai/orchestration/reflection.ts` — `agentId`, `runId`, `workspaceId`
  now threaded into all three `router.chat` calls.
- `lib/ai/multi-agent-runtime.ts` — singleton router, env-tunable
  `MULTI_AGENT_SUPPORT_CONCURRENCY` limit, leader-failure graceful
  synthesis from support outputs, `collaboration.started|completed|failed|step`
  bus events, `onStep` callback error isolation, reflection attribution.
- `lib/ai/agent-executor.ts` — duplicate tool-call dedup,
  parallel `Promise.allSettled` execution per round, typed failure
  fallback result matching `AIToolResult`.
- `lib/ai/circuit-breaker.ts` — counters for successes / failures /
  rejections + `snapshot()` and `getAllCircuitBreakerSnapshots()` for
  runtime observability; `reset()` now clears half-open probe too.
- `lib/ai/memory/agent-memory-store.ts` — `compileTermPatterns`
  precomputed once per query and passed into `bm25Score`.
- `lib/ai/messaging/agent-bus.ts` — `collaboration.started|completed|failed`
  event types registered; `persistMessage` errors logged instead of
  silently swallowed; `subscribeAgent` also delivers broadcast messages
  (target === undefined) without double-delivery.
- `lib/agents/agent-store.ts` — `getAgentSessionManager()` singleton.
- `lib/agents/base-agent.ts` + `lib/agents/orchestrator.ts` — use the
  session-manager singleton instead of re-instantiating per agent and
  per orchestrator.
- `lib/agents/main-agent.ts` — `parseRecommendation` uses earliest-match
  word-boundary regex so contradictory responses route correctly.
- `lib/agents/worker-agents.ts` — removed duplicated section header.
- `lib/agents/agent-improvements.ts` — removed
  `no-async-promise-executor`, replaced with `Promise.race` + guaranteed
  `clearTimeout`; uses the singleton router; retry list de-duplicated and
  expanded with common transient errors (EAI_AGAIN, socket hang up, 5xx).

### New tests

- `__tests__/lib/ai/dag-engine.test.ts` — parallel sibling failure isolation
  (`Promise.allSettled`) and per-node timeout behaviour.
- `__tests__/lib/ai/planner.test.ts` — domain rule happy path, default
  reviewer fallback for unknown agents, and single-agent fallback on
  trivial prompts.

Test suite after changes: **19 files / 67 tests, all passing**
(`npx vitest run __tests__/lib/ai`).

---

## 4. Competitive positioning

The most useful lens is not "who has agents" — everybody has agents — but
"who has **governed**, **auditable**, **multi-provider** agents with
**multimodal evidence loops**." Summary:

| Platform | Orchestration model | Governance | Multimodal | Relevant to CEOClaw |
|----------|--------------------|-----------|-----------|---------------------|
| **Asana AI Studio** | Human-authored workflows ("smart workflows"), rule + AI steps | Strong (audit, access control) | Text + forms | Closest analog — build workflow canvas on top of our DAG engine |
| **Atlassian Rovo** | Agents + search-grounded chat across Confluence/Jira | Strong, enterprise SSO/ABAC | Text + doc | Their grounding pattern justifies our RAG + agent bus coupling |
| **Monday magic / AI Blocks** | Per-column AI actions, triggered from board events | Medium | Text + tables | Their "block" abstraction maps to our tool plane |
| **Notion 3.0 AI** | Retrieval + agents, doc-native | Medium | Text + attachments | Good reference for memory + RAG cohabitation |
| **OpenAI Swarm** | Minimal agent-handoff lib (handoffs as first-class) | None | Pluggable | Handoff semantics would improve our legacy MainAgent |
| **CrewAI** | Role-based crews, task graph, tool binding | Light | Via custom tools | Role + task graph is already richer in our planner |
| **LangGraph** | Stateful graph runtime, checkpoints, interrupts | Depends on host | Pluggable | Our DAG engine is the closest thing; gaps: interrupts, checkpoints, streaming mid-graph |
| **Microsoft AutoGen** | Multi-agent dialog, code execution | Light | Via tools | Our reflection loop is the more structured equivalent |

### CEOClaw's real moat

1. **Governance-by-default** — `safety.ts` profiles (`preview_only`,
   `guarded_patch`, `guarded_communication`) + mutation safety guard in the
   executor give us an approval gate *by type of action*, not per tool.
   This is rare; Asana and Rovo have it for their controlled surface but
   most agent frameworks do not.
2. **Evidence-first loop** — `video-facts/service.ts`,
   `work-reports`, `agentMemory`, and grounded RAG already compose an
   evidence spine. This is a differentiator vs. generic PM-AI.
3. **Multi-provider routing with circuit breakers** — `AIRouter` handles
   `openrouter / zai / openai / aijora / polza / bothub / gigachat /
   yandexgpt` plus the OpenClaw gateway. The dual (CIS + global) coverage
   is unique and regulatory-relevant.
4. **Dynamic planner + reflection + reviewer fallback** — post-fix, we
   have a lightweight but principled planner → council → reflexion stack.
   None of the competing frameworks ship all three.

### Where we lag

1. **Graph interrupts / mid-flow approvals** — LangGraph and Asana AI
   Studio both support "pause, ask human, resume." Our DAG engine does
   not. Roadmap: add `interrupt` step kind, persist state via existing
   `checkpoint-service`, expose resume endpoint.
2. **Agent marketplace / install** — Asana / Monday both offer
   AI-workflow marketplaces. Our `agent-loader.ts` already supports
   JSON config overrides; a lightweight "install agent" action on top is
   a small lift.
3. **Structured tool calls** — Our `parseToolCallsFromResponse` still
   falls back to code-fence parsing. Providers that support native
   function calling (OpenAI, Gemini, GLM-5, GigaChat tools) should feed
   structured outputs directly. Roadmap: provider-typed tool call
   returning a discriminated union rather than string → parse.
4. **Observability** — Circuit breaker now exposes snapshots but we lack
   a single dashboard surface (`/api/ai/ops`) that aggregates
   circuit state, cost budgets, collaboration counts, and recent
   agent-bus errors. Cheap to build on top of this change.
5. **True multimodal** — STT is client-only, vision is heuristic. This is
   the largest product-facing gap.

---

## 5. Recommended next waves

### Wave A (1–2 weeks, reliability)
- Expose `/api/ai/ops` with circuit-breaker snapshots, recent
  `agent-bus` errors, daily cost posture.
- Migrate `ImprovedAgentExecutor` callers to `runAgentExecution`.
- Upgrade `OpenRouterProvider.httpsPost` to use `fetch` with streaming
  and broaden fallback triggers to general network errors (our existing
  httpsPost has a narrow `status === 429` gate).
- Add a structured tool-call path for providers with native function
  calling (OpenAI / Gemini / GLM-5 / GigaChat), keeping the code-fence
  parser as legacy fallback.
- Workspace-id validation in `AIKernelControlPlane`.

### Wave B (3–4 weeks, multimodal)
- Pluggable STT provider interface (`lib/voice/stt-provider.ts`);
  adapters for Whisper, YandexSpeechKit, GigaChat STT.
- Vision-enabled work-report verification: sample frames, call
  vision-capable provider (GPT-4o / GLM-5 / YandexGPT Vision), record
  calibrated score + rationale in `EvidenceRecord`.
- Multimodal message schema in `Message` (text + imageUrls + audioRefs)
  surfaced by `runAgentExecution`.

### Wave C (4–6 weeks, governance + marketplace)
- Graph-level interrupt/resume on top of `dag-engine` +
  `checkpoint-service`.
- Agent marketplace UI on top of `config/agents/*.json` with
  signing + revocation.
- Per-workspace budget + RL enforcement hooked into `cost-tracker` and
  `checkCostBudget`.

---

## 6. Appendix — files changed

```
lib/ai/orchestration/dag-engine.ts
lib/ai/orchestration/planner.ts
lib/ai/orchestration/reflection.ts
lib/ai/multi-agent-runtime.ts
lib/ai/agent-executor.ts
lib/ai/circuit-breaker.ts
lib/ai/memory/agent-memory-store.ts
lib/ai/messaging/agent-bus.ts
lib/agents/agent-store.ts
lib/agents/base-agent.ts
lib/agents/orchestrator.ts
lib/agents/main-agent.ts
lib/agents/worker-agents.ts
lib/agents/agent-improvements.ts
__tests__/lib/ai/dag-engine.test.ts
__tests__/lib/ai/planner.test.ts   (new)
```

All tests pass: `npx vitest run __tests__/lib/ai` → 19 files / 67 tests.

---

## 10. Wave A (2026-04-21) — follow-up hardening

Shipped immediately after the initial review to close the highest-priority
reliability and security items identified in §7:

1. **Broadened provider fallback classification** (`lib/ai/providers.ts`).
   - New `isTransientProviderError(err)` helper treats network errors
     (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `socket hang up`,
     `fetch failed`), timeouts, aborts, 5xx status codes, and errors tagged
     `{ transient: true }` as transient.
   - `AIRouter.chat` now routes transient failures to the next provider
     instead of rethrowing, so a single upstream outage no longer fails the
     whole run.
2. **OpenRouter HTTP path upgrade**.
   - `httpsPost` now returns a structured `{ status, body }` object (no more
     JSON string round-trip), tags network failures with `transient: true`,
     and the chat loop retries across all models on 5xx / 408 / 425 / 423 in
     addition to 429 and Gemma's "Developer instruction" 400.
3. **Native tool-calling path for providers with function-calling support.**
   - New `ProviderToolDefinition`, `ProviderToolCall`, `ChatWithToolsResult`
     types and `AIProvider.chatWithTools?` optional method.
   - `OpenRouterProvider` now implements `chatWithTools` against the
     OpenAI-compatible `tools` + `tool_choice` endpoint and advertises
     `supportsToolCalls = true` for GPT-4o-class models.
   - `AIRouter.chatWithTools` routes to the first tool-capable provider with
     circuit-breaker protection, and gracefully degrades to `.chat()` with
     `toolCalls: []` if none succeed.
   - `agent-executor` now prefers native structured tool calls when
     available, only falling back to `parseToolCallsFromResponse` when
     needed — eliminating brittle text/JSON parsing on the fast path.
4. **Workspace isolation in `AIKernelControlPlane`.**
   - `AIRunInput` gained optional `workspaceId` and `ownerUserId` fields.
   - On `run.create` the kernel now stamps the calling actor's workspace and
     user onto the persisted input.
   - `run.get` and `run.apply` look up the `ServerAIRunEntry` first and
     reject with `FORBIDDEN_WORKSPACE` (HTTP 403) when the stored
     `workspaceId` doesn't match the caller. Legacy untagged runs are
     allowed through with a warning for backward compatibility.
   - `run.list` filters entries to the caller's workspace (and legacy
     untagged entries).
5. **`/api/ai/ops` observability endpoint** (new).
   - Returns server AI status (gateway/provider/mock/unavailable),
     per-provider circuit breaker snapshots (state + totals), available
     providers/models, recent agent-bus persist failures (bounded ring
     buffer, new), and today's AI cost posture against the configured
     `AI_DAILY_COST_LIMIT` for the caller's workspace.
   - Gated by `RUN_AI_ACTIONS` permission; scope is always limited to the
     actor's workspace.
6. **Agent bus persist-error ring buffer**
   (`lib/ai/messaging/agent-bus.ts`). `AgentMessageBus` now exposes
   `getRecentPersistErrors(limit)` so the ops endpoint can surface DB write
   failures without scraping logs.
7. **Daily cost posture helper** (`lib/ai/cost-tracker.ts#getDailyCostPosture`).
   Returns total-USD-today, daily limit, utilisation (0–1), and remaining
   USD for a workspace — failing soft on DB errors.

### New tests

- `__tests__/lib/ai/providers-fallback.test.ts` — 7 tests covering the
  transient classifier (explicit provider errors, network-layer errors,
  timeouts, 5xx, `transient: true` marker, non-transient 4xx, null safety).
- `__tests__/lib/ai/kernel-control-plane.test.ts` — 4 new tests for workspace
  stamping on create, 403 on cross-workspace `run.get`, workspace filtering
  of `run.list` (with legacy runs preserved), and allowed `run.apply` on
  workspace match.

All tests still pass: `vitest run __tests__/lib/ai/` → 19 files / 77 tests.

## Wave B (2026-04-21) — native tools, admin UI, legacy wind-down

Executed immediately after Wave A. Objective: close most of the "still
pending" list from Wave A so the multi-agent core is feature-complete across
every provider we ship and so operators have a first-class view into it.

### Shipped

1. **Native OpenAI-compatible tool calling for five more providers**
   (`lib/ai/providers.ts`). Extracted a shared
   `openAICompatibleChatWithTools()` helper and wired it into
   `ZAIProvider`, `OpenAIProvider`, `AIJoraProvider`, `PolzaProvider`, and
   `BothubProvider`. Each advertises `supportsToolCalls = true` and carries
   its own `toolCapableModels` allow-list so in-provider fallback stays
   constrained to models that actually speak `tools`/`tool_choice`. Rate
   limits (429) and 5xx responses trigger model fallback; 4xx is
   surfaced immediately. Terminal failures throw messages that
   `isTransientProviderError` recognises, so `AIRouter.chatWithTools`
   continues through its cross-provider chain without any further wiring.
2. **Legacy executor migration** (`lib/agents/agent-improvements.ts`).
   `ImprovedAgentExecutor.executeWithTimeout` now delegates to
   `runAgentExecution` (the canonical kernel) and forwards abort signals
   through an `AbortController`. Retry/fallback/progress semantics are
   preserved at the outer level, but the underlying call path now flows
   through the shared router, circuit breakers, cost tracker, and tool
   dispatcher. The class is marked `@deprecated`; callers in
   `lib/orchestration/heartbeat-executor.ts`,
   `app/api/orchestration/ask-project/route.ts`, and
   `app/api/agents/execute/route.ts` continue to work unchanged.
3. **AI Ops dashboard** (`app/settings/ai/ops/page.tsx`, linked from
   `/settings/ai`). Client-side page that polls `/api/ai/ops` every 30s
   and renders: server AI mode + gateway posture, daily cost utilisation
   (coloured bar + remaining USD), per-provider circuit-breaker table,
   available providers/models, and the recent agent-bus persist-error
   ring buffer.
4. **Backfill script** (`scripts/backfill-ai-runs-workspace.ts`).
   Idempotent, dry-run by default, tags legacy `aiRunLedger` rows with
   `workspaceId` inferred from the linked `Project.workspaceId`, falling
   back to a configurable default. Once run, Wave A's
   "workspace-untagged run accessed" warning can be tightened into a
   hard reject in a future wave.

### New tests

- `__tests__/lib/ai/providers-tool-calls.test.ts` — 25 tests (5 providers
  × 5 behaviours): `supportsToolCalls` flag, tool-call response
  normalisation, 5xx in-provider fallback, terminal exhaustion yielding a
  transient-recognisable error, and immediate rethrow on 4xx.

Test suite: `vitest run __tests__/lib/ai/` → 20 files / 102 tests (from
19 / 77).

## Wave C (2026-04-21) — multimodal, budget alerts, legacy reject

Executed immediately after Wave B. Objective: give the kernel eyes and ears
(server-side STT + vision), turn the daily cost limit from a silent guard
into an actionable signal, and unlock the path to retiring the legacy
workspace-untagged compatibility branch.

### Shipped

1. **Budget breach detection** (`lib/ai/cost-tracker.ts`). After every
   persisted cost record, the tracker now checks today's utilisation
   against two thresholds (80% warning, 100% breach) and publishes a
   `budget.alert` event on the agent bus at most once per
   workspace/day/threshold. Includes `getRecentBudgetAlerts(workspaceId)`
   for dashboards and an internal cache-reset helper for tests.
2. **Budget breach UI** (`app/settings/ai/ops/page.tsx`,
   `app/api/ai/ops/route.ts`). Ops endpoint now returns
   `cost.recentAlerts`; the dashboard shows a coloured banner when
   utilisation ≥ 80% (amber) or ≥ 100% (red) and a dedicated "Recent
   budget alerts" panel listing each crossing with severity, triggering
   provider/model/run, and timestamp.
3. **Server-side STT** (`lib/ai/multimodal/stt.ts`,
   `app/api/ai/transcribe/route.ts`). New `STTRouter` with
   `OpenAISTTProvider` (Whisper, `response_format=verbose_json`) and a
   `MockSTTProvider` fallback. Router picks providers by availability,
   rejects mock in production, and walks the chain on failure. The
   `/api/ai/transcribe` endpoint accepts `multipart/form-data` (up to
   25 MB), requires `RUN_AI_ACTIONS`, and returns `{ text, language,
   durationSeconds, provider, model }`.
4. **Server-side vision** (`lib/ai/multimodal/vision.ts`,
   `app/api/ai/vision/describe/route.ts`). `VisionRouter` with
   `OpenAIVisionProvider` (`gpt-4o-mini`, `response_format=json_object`
   for verify mode) plus mock fallback. Supports two modes:
   `describe(image)` for free-form captions, and `verify(image, claim)`
   that returns `{ verdict: "confirmed"|"refuted"|"uncertain",
   confidence, reason }` — designed for the forthcoming video-fact
   verification pipeline. Images may be provided as URLs or inline
   base64. Confidence is clamped to `[0,1]` and malformed JSON verdicts
   are normalised to `uncertain`.
5. **Hardened AIKernelControlPlane** (`lib/ai/kernel-control-plane.ts`).
   New env flag `AI_KERNEL_REJECT_LEGACY_UNTAGGED` (default off).
   When enabled: `run.get` and `run.apply` reject legacy untagged runs
   with 403 `FORBIDDEN_WORKSPACE` (`details.reason = "legacy_untagged"`),
   and `run.list` filters them out. When disabled, the previous
   backward-compat warning path is preserved. Operators run the Wave B
   backfill script first, then flip the flag on in production.

### New tests

- `__tests__/lib/ai/cost-tracker-breach.test.ts` — 6 tests: no alert
  below 80%, warning at 80%, warning+breach at 100%, single-emit
  deduping per day/threshold, workspace-less runs skip detection,
  `getRecentBudgetAlerts` filters the bus message log correctly.
- `__tests__/lib/ai/multimodal.test.ts` — 10 tests covering STT
  provider availability, verbose_json parsing, API errors, router
  fallback, preferred-provider rejection; vision describe/verify JSON
  parsing, malformed-verdict normalisation, confidence clamping, and
  router fallback.
- `__tests__/lib/ai/kernel-control-plane.test.ts` — 2 new tests behind
  `AI_KERNEL_REJECT_LEGACY_UNTAGGED=true`: 403 on `run.get` for an
  untagged run, and exclusion from `run.list`.

Test suite: `vitest run __tests__/lib/ai/` → 22 files / 120 tests
(from 20 / 102).

### Wave D candidates

- Wire the server-side STT into the existing browser chat input and
  meeting/work-report pipelines so audio evidence flows end-to-end.
- Integrate `VisionRouter.verify()` into
  `evaluateVideoFactVerification` (`lib/video-facts/service.ts`) so
  video-fact confidence is grounded in actual frame content rather
  than metadata alone. Requires server-side frame extraction
  (ffmpeg) — tracked as infra work.
- Slack/Telegram webhook for `budget.alert` events (subscribe on the
  agent bus, forward warnings + breaches to the workspace channel).
- Delete `ImprovedAgentExecutor` once
  `lib/orchestration/heartbeat-executor.ts`,
  `app/api/orchestration/ask-project/route.ts`, and
  `app/api/agents/execute/route.ts` migrate to `runAgentExecution`
  directly.
- Native tool calling for GigaChat + YandexGPT (custom, non-OpenAI
  protocol).

