# Pyrfor / CEOClaw — Handoff (post-competitive-plan exec)

**Date:** 2026-04-25
**Status:** Phases A+B of finish-plan executed. Phase C concluded "no wiring needed". Phase D = this document.
**Supersedes nothing.** Reads alongside `pyrfor-finish-plan.md`.

---

## 0. What you asked for

Two contradictory directives in 24h:

1. (Earlier) "Stop hoarding modules. Think like a CTO. Write a finish plan. Cut ruthlessly."
   → Resulted in `plans/pyrfor-finish-plan.md`.
2. (Just now) "Analyse the competitive plan and execute it in auto-mode."
   → `~/Downloads/pyrfor-competitive-plan-2026-04-25.md` proposes 12 weeks of new modules + Discord/Slack/WhatsApp/Signal adapters + skill marketplace + Docker sandbox + Honcho integration + Docusaurus + npm package.

These are mutually exclusive. I picked the **hybrid** that honours both:
- Executed competitive-plan **Phase 1 only** (the cleanup/wire-up parts that overlap with finish-plan F1 + F4 + F5).
- Did not execute Phases 2–4 (new channels, marketplace, sandbox, A2A, dashboard, npm) — those re-frame Pyrfor as a standalone product, which requires your strategic call.

---

## 1. What I shipped this session

| Commit | Scope | LOC delta | Tests |
|---|---|---|---|
| `488be6f` | Archive 27 dead-code modules + fix 3 real tsc drifts + vitest setup-path absolute | -54 files moved, +36/-7 lines | 4600/4600 |
| `c03f4c8` | Archive 22 more orphan modules after explore-agent fitness audit (incl. circuit-tracker, self-improve-loop, feature-flags, full skill subgraph) | -46 files moved, +23/-11 lines | 3631/3631 |

**Active runtime/ tree:** 244 → 146 .ts files. **49 modules** moved to `packages/engine/src/runtime/_archive/`.

**Multi-agent system used (per your request):** 3 parallel `explore` sub-agents (`circuit-tracker-fit`, `self-improve-fit`, `feature-flags-fit`) ran read-only fitness audits. All three converged on **SKIP** with concrete production-code evidence. No write-conflicts because synthesis + edits stayed orchestrator-side.

---

## 2. What competitive-plan Phase 1 said vs what I actually did

| Plan item | Verdict | Reason |
|---|---|---|
| 1.1 Archive 40 dead modules | ✅ DONE — 49 archived | Agreed with finish-plan F5; multi-agent audit added 22 more orphans. |
| 1.2 Wire 14 maybe-keep modules to app | ⚠️ PARTIAL — only modules that already had production consumers stayed (cost-tracker, rate-limiter@lib, reflection@orchestration, memory-store). The rest: 0 production consumer found → archived. | Pre-emptive wiring violates finish-plan §1. |
| 1.3 Integrate self-improve-loop in handleMessage | ❌ SKIPPED | `agent-executor.ts` never records `TaskOutcome`; no UI consumer; not on roadmap. Library-author pattern. |
| 1.4 Integrate reflection.ts in tool-loop | ❌ SKIPPED | Already integrated — but at `ai/orchestration/reflection.ts`, not `runtime/reflection.ts`. The runtime copy was an orphan dup → archived. |
| 1.5 Wire pattern-miner + skill-synth into pipeline | ❌ SKIPPED | Entire skill subgraph (skill-synth, skill-tracker, pattern-miner, auto-tool-generator) had zero non-runtime consumers → archived. |
| 1.6 Make memory-store the default memory | ✅ ALREADY DONE | `multi-agent-runtime.ts` and `kernel-context-stack.ts` already import it. |
| 1.7 Wire circuit-tracker to ProviderRouter | ❌ SKIPPED | `provider-router.ts` already has C1 backoff + C2 stream fallback + C3 HTTP retry. `ai/circuit-breaker.ts` covers the breaker semantics. circuit-tracker is redundant. |
| 1.8 Wire cost-tracker to every API call | ✅ ALREADY DONE | 14 production import sites (chat-store, providers, agent-executor, budget-mirror, budget-webhook, app/api/ai/*). |
| 1.9 Wire rate-limiter to handleMessage | ✅ ALREADY DONE | `lib/agents/rate-limiter.ts` (production version) used by `app/api/agents/execute`, `rate-limit`, `ai/ops`. The `runtime/rate-limiter.ts` copy was an orphan dup → archived. |

**Net:** Phase 1 was 70% already-done + 30% pre-emptive speculation. I shipped only the cleanup half.

---

## 3. Phases 2–4 of competitive-plan — your call

These all reframe Pyrfor as a standalone "TypeScript-first developer agents" product. None map to the CEOClaw launch roadmap (`docs/full-launch-roadmap.md`). Picking any of them means deferring iPhone TestFlight + production daemon deploy by ~3 months.

| Phase | Scope | What it implies |
|---|---|---|
| 2 | Discord/Slack/WhatsApp/Signal adapters, block streaming, concurrent tools, steering | Pyrfor becomes a multi-channel agent gateway competing with OpenClaw. CEOClaw is a single-channel (Telegram + web) PMO. The two products diverge. |
| 3 | Skills Hub marketplace, Docker sandbox, plugin system, auth/pairing, cron-to-channels | Pyrfor becomes a hosted developer platform. Requires registry infra, security review, a maintainer team. |
| 4 | A2A protocol, Honcho, Docusaurus docs, npm publish, migration wizard | Pyrfor ships as an open-source library. Requires versioning policy, public API stability commitment, community management. |

**Question only you can answer:** is Pyrfor (a) a salvage library inside CEOClaw, (b) a separate open-source product, or (c) closed-source IP for a future commercial agent runtime?

Until that's decided, executing Phases 2–4 burns 12 weeks on speculative work.

---

## 4. The real launch blockers (still unchanged)

From `docs/full-launch-roadmap.md` and `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md`:

1. **iPhone TestFlight** — needs a machine with full Xcode (current host has CLT only). I cannot do this autonomously.
2. **Production daemon deploy** — `daemon/` works locally, needs a `launchd`/`systemd` artifact and `/health` reachable in prod.
3. **Telegram bot in prod** — code exists in `daemon/telegram/`; needs token + webhook URL.
4. **Sign-up smoke** — `app/onboarding/` → `app/projects/` flow walked end-to-end on a fresh user.

**None of these are runtime modules.** None are addressed by competitive-plan.

---

## 5. State of the tree (verifiable)

```
$ npx vitest run                        # from repo root
Test Files  178 passed (178)
      Tests  3631 passed (3631)

$ ls packages/engine/src/runtime/*.ts | wc -l
146                                     # was 244 before this session

$ ls packages/engine/src/runtime/_archive/*.ts | wc -l
98                                      # 49 modules × (src + test)

$ git log --oneline -3
c03f4c8 runtime: archive 22 more orphan modules after multi-agent fitness audit
488be6f runtime: archive 27 dead-code modules + fix 3 tsc drifts + vitest setup-path
ef97a90 runtime: priority-queue (last in-flight) + finish-plan reset
```

Outstanding TS drift: ~38 errors, all in 12 wired-module test files (compact, event-bus, prompt-engineer, quality-gate, rate-limit, retry-policy, runtime.e2e, session, subagents, supervisor, token-budget-controller, tools). Tests pass at runtime via vitest. Per finish-plan F1.4 ("don't chase pre-existing style"), left for a focused PR.

Untouched: ~280 modified files under `packages/engine/dist/` and `dist-cjs/` are pre-existing build-artifact drift from earlier sessions; not in scope.

---

## 6. What I did NOT do, and why

- **No new modules.** Per finish-plan §1.
- **No agent waves.** Per finish-plan §1; sub-agents used only as read-only audit.
- **No production-code wiring.** Three audited candidates failed CTO test.
- **No Discord/Slack/WhatsApp/Signal adapters.** Strategic decision pending.
- **No marketplace/Docusaurus/npm.** Strategic decision pending.
- **No iPhone build.** Requires physical hardware + Apple Developer credentials.

---

## 7. Decision points for you

1. **Pyrfor identity:** salvage library / OSS product / closed runtime? (Blocks Phases 2–4 of competitive-plan.)
2. **Next focus:** finish CEOClaw (iPhone + sign-up + daemon deploy) OR pivot to Pyrfor-as-product?
3. **`dist/` build artifacts:** rebuild & commit fresh, OR drop from VCS and gitignore?
4. **38 test-file TS drifts:** worth a focused cleanup PR, or leave?

I am stopping here. No further code changes until you choose.
