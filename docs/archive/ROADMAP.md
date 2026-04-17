# CEOClaw — Current Roadmap State

**Last Updated:** `2026-03-25`
**Current Baseline:** `0.1.0` web package
**Current State:** Old roadmap is closed in repository code except for external Postgres bootstrap validation

---

## Validation baseline

- `132/132` tests passing
- clean `npm run lint`
- clean production build against Postgres env vars
- `131` app/API routes
- `0` production vulnerabilities via `npm audit --omit=dev`

---

## What the old roadmap closed

### Track A — Foundation

- [x] docs sync
- [x] Postgres-first runtime path in repo code
- [x] SQLite bridge removed from active production paths
- [x] production vulnerability cleanup

### Track B — Quality

- [x] E2E smoke recovery
- [x] TypeScript/build cleanup required for a clean green baseline
- [x] bundle-risk reduction in the main client shell
- [x] post-deploy smoke restoration

### Track C — Feature convergence

- [x] evidence analysis slice
- [x] approval workflow convergence
- [x] role-aware UI surfaces beyond work reports
- [x] signal packet outputs and exports
- [x] Telegram + email signal-packet delivery
- [x] task dependency insights + live dependency workspace

---

## Only remaining blocker from the old plan

### `a2-cutover-validate` (external)

Run the committed Postgres migration/bootstrap path against a disposable real Postgres environment and record that it:

1. applies cleanly from scratch;
2. leaves no schema drift;
3. matches the current runbook/deploy story.

Until that rerun is recorded, “Production Ready” is still too strong.

---

## What comes after this

The next roadmap should be treated as **new scope**, not as unfinished rescue work.

Reasonable follow-on themes:

- broader Playwright confidence beyond smoke;
- ongoing docs/ops truth maintenance;
- deeper connector and export expansion where it adds clear product value;
- launch/package work outside the old foundation roadmap.

---

## Immediate next focus

If the goal is to close the last old-plan gap, the next concrete action is simple:

**run the disposable real-Postgres validation for `a2-cutover-validate`.**
