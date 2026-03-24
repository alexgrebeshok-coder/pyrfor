# CEOClaw — Execution Roadmap

**Last Updated:** `2026-03-24`  
**Current Baseline:** `0.1.0` web package  
**Current State:** Working product; foundation repo cleanup largely landed, quality hardening active

---

## Current reality

CEOClaw already has a substantial product surface and live deployment story, but the next phase is **not** feature theater. The main objective is to make the foundation honest and durable before claiming release readiness.

---

## Release gates before any `production ready` claim

The following must be true at the same time:

1. Entry-point docs describe the real state of the product.
2. Postgres is the clean primary production path.
3. Tactical SQLite bridge is removed from the production story.
4. High / critical production vulnerabilities are closed.
5. E2E smoke and post-deploy smoke act as reliable default gates.
6. Build, tests, and quality gates stay green without caveats.

---

## Track A — Foundation (4 tasks)

**Goal:** make the core platform honest, safe, and production-shaped.

- [x] `a1-docs-sync` — sync README/status/summary/roadmap docs with current reality
- [x] `a2-postgresql-cutover` — complete the Postgres-first runtime path and baseline
- [x] `a3-remove-sqlite-bridge` — remove tactical SQLite production dependencies and fallback assumptions
- [x] `a4-security` — current `npm audit --omit=dev` is clean

Track A code cleanup is effectively landed in-repo. The main remaining follow-up is to rerun the fresh/legacy Postgres bootstrap against a disposable live database in an environment that has Docker or local Postgres available.

---

## Track B — Quality (4 tasks)

**Goal:** raise delivery confidence and make regressions visible earlier.

- [x] `b1-e2e-recovery` — restore Playwright as a trustworthy gate instead of a skipped-by-default path
- [ ] `b2-ts-cleanup` — reduce warning debt across TypeScript / ESLint / runtime edge cases
- [ ] `b3-bundle-opt` — continue bundle and page-weight optimization
- [x] `b4-postdeploy-smoke` — keep post-deploy smoke mandatory and stable after every deploy

---

## Track C — Stage 2 Features (6 tasks)

**Goal:** unlock the next product layer after the foundation is stable.

- [ ] `c1-evidence-ai`
- [ ] `c2-approval-workflow`
- [ ] `c3-role-surfaces`
- [ ] `c4-outputs`
- [ ] `c5-connectors`
- [ ] `c6-dependencies`

---

## Recommended execution order

1. Finish **Track A**.
2. Lock in **Track B** so deploy confidence is real.
3. Expand **Track C** once the platform can absorb feature growth safely.

---

## Immediate next focus

After foundation cleanup lands, the next objective is:

**`b2-ts-cleanup`**

That is the highest-leverage task because the repo baseline is green again, but lint still carries a visible warning backlog. After that, `b3-bundle-opt` is the natural next Quality task.
