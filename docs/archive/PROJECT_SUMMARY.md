# CEOClaw — Project Summary

**Quick reference card**  
**Updated:** `2026-03-24`

---

## Snapshot

| Metric | Value |
|---|---|
| Web package version | `0.1.0` |
| Product posture | Working product; foundation hardening in progress |
| Stage 1 + 1.5 | `~95%` complete |
| API routes | `131` |
| Automated tests | `113/113` passing |
| TypeScript | `strict: true` |
| E2E in CI | targeted smoke default gate; `SKIP_E2E` is opt-out |
| Production vulnerabilities | `0` |
| Database posture | Shared Postgres schema + committed Postgres baseline |
| Next recommended track | `A — Foundation` |

---

## What is already true

- CEOClaw is a real, working PM/ops product, not a prototype deck.
- Vercel production/preview surfaces are live.
- Production build and automated test baseline are green.
- The repository already contains deploy, smoke, and operational runbooks.

---

## What is not yet true

- It is **not** honest to label the repo `1.0.0 MVP Ready`.
- The repo foundation is cleaner, but fresh Postgres bootstrap should still be rerun against a disposable live database in a Postgres-capable environment.
- E2E is **not** yet a default CI gate.
- Broader E2E confidence is **not** fully proven until the restored smoke gate runs cleanly over time in CI/runtime, not just by configuration.

---

## Current tracks

### A — Foundation

- [x] `a1-docs-sync`
- [x] `a2-postgresql-cutover`
- [x] `a3-remove-sqlite-bridge`
- [x] `a4-security`

### B — Quality

- [x] `b1-e2e-recovery`
- [ ] `b2-ts-cleanup`
- [ ] `b3-bundle-opt`
- [x] `b4-postdeploy-smoke`

### C — Stage 2 Features

- [ ] `c1-evidence-ai`
- [ ] `c2-approval-workflow`
- [ ] `c3-role-surfaces`
- [ ] `c4-outputs`
- [ ] `c5-connectors`
- [ ] `c6-dependencies`

---

## Recommended reading order

1. `README.md` — current project entry point
2. `PROJECT_STATUS.md` — operational truth and blockers
3. `ROADMAP.md` — execution tracks and release gates
4. `RUNBOOK.md` — deploy/run checklist
5. `docs/AI-RAG-SYSTEM.md` — subsystem notes
