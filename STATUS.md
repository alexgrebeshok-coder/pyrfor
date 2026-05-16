# Orchestration status (2026-05-16)

## E0 — Phase 1 consolidation

| Item | Status |
| --- | --- |
| PR #25 OSS | **Merged** |
| PR #26 npm publish | **Merged** (lockfile + sidecar vendor fix) |
| PR #27 SWE-bench smoke | **Merged** |
| `pnpm test` on integration `main` | **Pass** (6120 tests on local `backup/orchestration-main`) |
| `pnpm swe-bench:smoke` | **Pass** |
| npm publish verify | **Blocked** — requires repo secret `NPM_TOKEN` (see `docs/RELEASE.md`) |
| Local `main` vs `origin/main` | **64 commits** on `backup/orchestration-main`; split into PRs #28–#32+ below |

## Follow-up PRs (split from local integration)

| Stage | PR | Branch |
| --- | --- | --- |
| E1 | [#28](https://github.com/alexgrebeshok-coder/pyrfor/pull/28) | `e1/release-foundation` |
| E2 | [#29](https://github.com/alexgrebeshok-coder/pyrfor/pull/29) | `e2/trust-isolation` |
| E3 | [#30](https://github.com/alexgrebeshok-coder/pyrfor/pull/30) | `e3/observability-protocols` |
| E5 | [#31](https://github.com/alexgrebeshok-coder/pyrfor/pull/31) | `e5/block-walking-skeleton` |
| E4 | [#32](https://github.com/alexgrebeshok-coder/pyrfor/pull/32) | `e4/proof-dx` |
| E6 | (pending push) | `e6/si-ux` |

Remaining local-only work (IDE gateway wiring, full budget e2e, ACP, VS Code): see `docs/OPERATIONS-ROADMAP.md`.
