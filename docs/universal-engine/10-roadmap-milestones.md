# 10 — Roadmap & Milestones

> ← [09 — API · CLI · VS Code](./09-api-cli-vscode.md) · далее → [11 — Prior Art](./11-prior-art.md)

---

## 10.1 Принципы порядка

1. **Safety first.** Substrate of meaning + Verification + Governance — раньше любого ToolForge.
2. **Аддитивность.** Каждый milestone компилируется на чистом дереве; FreeClaude путь не трогаем.
3. **Feature-flag.** Всё за `features.universalEngine` до M17.
4. **Без оценок времени.** Только зависимости и acceptance.
5. **Algorithmic governance early.** Контракты `governedByAlgorithm`, checkpoint policy, completion criteria и feedback policy появляются в M1, чтобы все следующие milestone строились поверх них.

---

## 10.2 Граф зависимостей

```mermaid
graph TD
    Decisions[ue-decisions<br/>Подтвердить 5 решений]
    M1[M1 Substrate of meaning]
    M2[M2 Stores & registries]
    M3[M3 Sandbox + Effect Gateway]
    M4[M4 Tier Decider + Approval + Budget]
    M5[M5 Verifier ensemble]
    M6[M6 Planner + Researcher]
    M7[M7 UniversalEngineOrchestrator]
    M8[M8 Gateway + SSE]
    M9[M9 packages/cli]
    M10[M10 Docker + container tiers]
    M11[M11 ToolForge + SelfExtension]
    M12[M12 Tester + Acceptance]
    M13[M13 Memory full + Historian]
    M14[M14 Delivery + PostMortem]
    M15[M15 Self-improvement gated]
    M16[M16 VS Code extension]
    M17[M17 Evals + flag flip]

    Decisions --> M1
    M1 --> M2 & M3 & M4 & M5
    M2 --> M6
    M5 --> M6
    M2 --> M7
    M3 --> M7
    M4 --> M7
    M5 --> M7
    M6 --> M7
    M7 --> M8 --> M9
    M3 --> M10
    M3 --> M11
    M4 --> M11
    M5 --> M11
    M10 --> M11
    M5 --> M12
    M11 --> M12
    M2 --> M13
    M7 --> M13
    M12 --> M14
    M13 --> M15
    M14 --> M15
    M8 --> M16
    M14 --> M17
    M15 --> M17
    M16 --> M17
```

---

## 10.3 Milestones

| # | Название | Главные файлы | Acceptance |
|---|---|---|---|
| **M1** | Substrate of meaning + enforcement ownership | `runtime/universal/{completion-gate-engine,decision-record-auditor,legacy-node-auditor,historian}.ts`; `runtime/universal/memory/{provider,types,algorithm-aware-retriever,strategy-memory-provider,context-engine}.ts`; расширения `event-ledger.ts`, `artifact-model.ts`, `durable-dag.ts` | tsc clean; targeted tests зелёные; `beforeNodeComplete` blocks missing artifacts before `dag.node.completed`; DecisionRecord scorer deterministic; legacy audit and memory v2 contracts exported; ноль регрессий |
| **M2** | Stores & registries + Memory read-path | `runtime/universal/memory/{concept-store,strategy-store,memory-facade}.ts`; `runtime/universal/tool-registry.ts`; `guardrails.ts` (sandbox tier) | unit-тесты pass; `ConceptStore` project/cross-concept scope works; `StrategyStore` approved-only project isolation works; `ToolRegistry` persists/dedupes/retires append-only entries; `UniversalMemoryFacade` returns approved-only non-legacy lessons; sandbox tier enforced |
| **M3** | Effect Gateway + Sandbox + minimal ContextEngine compressors | `runtime/universal/{sandbox-executor,effect-gateway}.ts`; `runtime/universal/memory/context-engine.ts`; later `packages/sandbox/` (Wasm/container backends) | LocalProcess pass; EffectGateway enforces manifest effects/scope/budgets; engine без hard-dep на dockerode; deterministic bounded compressors pass; Wasm smoke deferred to backend slice |
| **M4** | Tier Decider + Approval + Budget | `runtime/universal/tier-decider.ts`; `approval-flow.ts`; `token-budget-controller.ts` | context-aware deterministic decisions unit-tested; `decision_vector` logged; budget exhaustion → approval/abort; no LLM in decider |
| **M5** | Verifier ensemble | `runtime/verifier-lane.ts` (extend); `runtime/universal/critic.ts` | ≥2 верификатора, family-diversity, quorum; «Critic agrees with Coder» test pass |
| **M6** | Planner + Researcher | `runtime/universal/{planner,researcher}.ts`; `ai/orchestration/planner.ts` | plan idempotency; OODA research loop bounded; injection-scan; offline-fallback Researcher |
| **M7** | UniversalEngineOrchestrator | `runtime/universal/{engine-loop,index}.ts`; `runtime/index.ts` | full loop test (mocked phases); resume-from-node; rollback; phase-boundary snapshot |
| **M8** | Gateway + SSE | `runtime/gateway.ts` + tests | новые routes shape OK; feature-flag 503; нет регрессии существующих routes |
| **M9** | packages/cli | `packages/cli/` | end-to-end CLI против local gateway; chat/telegram режимы intact |
| **M10** | Docker + container tiers | `packages/sandbox/src/{docker,firecracker}-backend.ts`; `container_net_allowlist` tier | tier escalation; egress allowlist enforced |
| **M11** | ToolForge + SelfExtension | `runtime/universal/{tool-forge,self-extension-loop}.ts`; `pyrfor-fc-skill-writer.ts` | manifest-first; TOC reuse/adapt/forge gate; static+dynamic taint; mandatory tests; ToolForge Lessons Learned artifact; promotion только в `sandboxed_experiment`; eviction test |
| **M12** | Tester + AcceptanceVerification | `runtime/universal/tester.ts`; интеграция с critic | тесты исполняемые; verification report shape; bounded rework |
| **M13** | Memory full + Historian | `runtime/universal/historian.ts`; `memory-facade.ts` extended | provenance на каждой записи; conflict → approval, не overwrite; double-loop lesson candidates quarantine/promote correctly |
| **M14** | DeliveryPackager + PostMortem | `runtime/universal/{delivery,postmortem}.ts` | manifest+checksum bundle; postmortem артефакт |
| **M15** | Self-improvement gated | `runtime/universal/meta-critic.ts` | algorithm-specific improvement proposals only; policy changes always human-tier; eval proof + rollback verified |
| **M16** | VS Code extension surface | extension package | tree views live; SSE trace renders; команды работают |
| **M17** | Evals + flag flip | `evals/universal-engine-evals.ts` | deterministic evals pass; full tsc clean; ноль FreeClaude регрессий; flip default `true` |

---

## 10.4 Migration discipline

- Каждый M аддитивен. Если M ломает существующий тест — это **bug**, переделываем.
- Все новые union-members в типах помечаем как optional там, где это не нарушает invariants.
- Все новые gateway routes — за `if (!deps.universalEngine) return 503`.
- `PyrforRuntime.startUniversalEngine()` — no-op, если `config.features.universalEngine !== true`.
- `dispatchConcept()` бросает `FeatureDisabledError`, если флаг выключен.
- `packages/sandbox` подключается через `await import()` — никаких синхронных require в `engine`.

---

## 10.5 Definition of Done на каждый M

1. ✅ Tsc проходит на всём монорепо.
2. ✅ Новые unit-тесты добавлены и зелёные.
3. ✅ Существующая FreeClaude regression suite зелёная.
4. ✅ Новые гардрейлы покрыты тестами (sandbox tier / verifier independence / tier decider — где применимо).
5. ✅ Документация в `docs/universal-engine/` обновлена (если изменены контракты).
6. ✅ Аудит-чеклист безопасности (см. [07.10](./07-safety-and-governance.md#710-чеклист-безопасности-перед-релизом-фичи)) пройден для затронутых поверхностей.
7. ✅ Memory changes prove approved-only retrieval, provenance, project isolation, and no raw/quarantined/rejected/legacy lesson injection into Planner/ToolForger.
8. ✅ Planning/search changes prove boundedness (`maxBranches`, `maxDepth`, `maxBacktracks`, `requiresNewEvidence`) before any lookahead/backtracking is enabled.
9. ✅ Cost-aware changes update `DecisionRecord.budgetImpact` and branch-pruning rationale; hard limits stay in TierDecider/BudgetController.
