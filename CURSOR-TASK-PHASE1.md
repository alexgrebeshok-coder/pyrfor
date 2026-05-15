# Cursor Task — Pyrfor Phase 1 Completion

**Date:** 2026-05-15
**Context:** Pyrfor is at ~45% completion. P0 critical tasks 7/10 done. Need to finish remaining P0 and prepare for public release.

---

## Context (read first)
Read these files for full project understanding:
- `/Users/aleksandrgrebeshok/pyrfor-dev/docs/PYRFOR-STATE-2026-05-15.md`
- `/Users/aleksandrgrebeshok/pyrfor-dev/docs/PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md`
- `/Users/aleksandrgrebeshok/pyrfor-dev/README.md`
- `/Users/aleksandrgrebeshok/pyrfor-dev/package.json`

---

## Task 1: OSS-Ready Repository

**Goal:** Make `github.com/alexgrebeshok-coder/pyrfor` fully open-source ready.

**Steps:**
1. Create `LICENSE` file with Apache 2.0 full text (root package.json already has `"license": "Apache-2.0"`)
2. Create `CODE_OF_CONDUCT.md` (standard Contributor Covenant)
3. Create `SECURITY.md` (how to report vulnerabilities)
4. **DELETE current CONTRIBUTING.md** (it has pm-dashboard content — wrong project!)
5. Create new `CONTRIBUTING.md` for Pyrfor:
   - Dev setup: `git clone` → `pnpm install` → `pnpm test` in under 10 minutes
   - Branch workflow: feature branch → PR → review → merge to main
   - Commit style: conventional commits
   - Test requirements: all tests must pass before PR

**Verify:**
```bash
ls LICENSE CODE_OF_CONDUCT.md SECURITY.md CONTRIBUTING.md
# All 4 files exist
head -3 CONTRIBUTING.md
# Shows Pyrfor content, NOT pm-dashboard
```

---

## Task 2: One-Command Install (P0-2)

**Goal:** `npx @pyrfor/engine concept "hello"` works on a clean machine in under 60 seconds.

**Steps:**
1. Root `package.json`: set `"private": false` (currently true — blocks npm publish)
2. Verify `packages/engine/package.json` has correct `"name": "@pyrfor/engine"` and version
3. Test: `npm pack` in engine package — produces a valid .tgz
4. The publish workflow already exists at `.github/workflows/publish-engine.yml` — verify it works
5. Publish to npm: `cd packages/engine && npm publish` (or trigger via CI)

**Verify:**
```bash
npm pack --dry-run 2>&1 | grep -i error  # should be empty
npx @pyrfor/engine concept "hello" --version  # works
```

---

## Task 3: SWE-bench Baseline (P0-6 groundwork)

**Goal:** Publish a SWE-bench Lite baseline score.

**Steps:**
1. Ensure SWE-bench smoke harness works: `pnpm swe-bench:smoke`
2. Run on 5-10 SWE-bench Lite tasks (not full 300—just baseline)
3. Document the score in README.md section "Benchmarks"
4. Set up GitHub Actions badge for nightly SWE-bench runs

**Verify:**
```bash
pnpm swe-bench:smoke
# Should pass with score output
```

---

## CONSTRAINTS
- **DO NOT** modify engine runtime logic (it's tested, working, 6100+ green tests)
- **DO NOT** change existing test files unless they fail
- **DO NOT** change docs/ strategy documents
- **DO** keep all changes additive — minimal changes, maximum effect
- **DO** run `pnpm test` after every change

## DONE WHEN
1. All 4 OSS files exist with correct content
2. `package.json` has `"private": false`
3. `npx @pyrfor/engine` is installable
4. SWE-bench smoke passes
5. All 6100+ tests still green
