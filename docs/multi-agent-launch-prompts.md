# CEOClaw Multi-Agent Launch Prompts

Updated: 2026-03-18
Repository: `/Users/aleksandrgrebeshok/ceoclaw-dev`
Branch baseline: local `main`, ahead of `origin/main`, dirty worktree is the current source of truth.

## Current reality

- Web product baseline is real: Next.js App Router, Prisma/Postgres, NextAuth, SWR, AI chat, Gantt, Calendar, operator docs.
- Desktop baseline now exists as a modernized Tauri v2 scaffold in `src-tauri/`.
- Mobile baseline now exists as a stronger installable PWA with manifest, service worker, offline page, and icons.
- Launch blockers still remain around live-contract honesty, tenant/data isolation, and production auth/security hardening.

## Session rules for every agent

- Treat the current local worktree as the baseline. Do not reset, revert, or clean unrelated files.
- Work only inside the files you own for your packet.
- Validate your slice before returning.
- Prefer explicit degraded states over hidden mock/demo fallback on production-facing surfaces.
- Do not claim launch-ready if auth, data scoping, or operator runbooks are still incomplete.

## Recommended execution order

1. Security/Auth hardening
2. Live-contract cleanup
3. Core data/API tenant scoping
4. Desktop packaging completion
5. Mobile packaging decision and shell
6. Final launch audit and runbook freeze

## Lead Orchestrator Prompt

```text
You are the lead orchestrator for CEOClaw in /Users/aleksandrgrebeshok/ceoclaw-dev.

Mission: finish the product into a launch-ready live-first application, plus a usable desktop app and a phone-ready delivery path, without losing the current local baseline.

Constraints:
- The worktree is already dirty and ahead of origin; treat it as the source of truth.
- Do not reset or revert unrelated changes.
- Split work into bounded packets with disjoint write scopes.
- Production contract must not silently fall back to demo/mock data on active operator-facing surfaces.
- Prefer shipping secure and honest behavior over feature illusions.

Current known truths:
- `npm run build` is green after recent hardening.
- `npm run test:run` reports 44/44 passing, though the suite still logs `useLocale` provider noise.
- Tauri v2 scaffold exists under `src-tauri/`.
- Mobile/PWA installability was improved in `public/`, `app/layout.tsx`, and `components/pwa-registrar.tsx`.
- The next highest-risk areas are auth/security, live-contract cleanup, and tenant/data scoping.

Your job:
1. Keep a running packet plan.
2. Delegate bounded tasks to workers with clear file ownership.
3. Integrate only after each packet validates.
4. End with a concrete release-candidate checklist: web, desktop, phone/PWA, auth, data, AI, and operations.
```

## Packet A: Security/Auth Prompt

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Goal: make the production auth and admin surface fail closed.

Own these files:
- app/api/middleware/auth.ts
- lib/auth/auth-options.ts
- app/api/auth/register/route.ts
- app/api/admin/**
- package.json
- prisma/seed-auth.ts
- .gitignore

Tasks:
- Keep `/api/admin/*` unavailable in production unless explicitly protected by server-side admin access.
- Remove production creation of default credentials.
- Ensure membershipless users cannot access the app through a fake/default role.
- Keep signup honest: either provision correctly for non-prod flows or disable self-serve production signup.
- Add or update env/docs comments only if needed for clarity.

Validation:
- `npm run build`
- explain any remaining warnings

Return:
- files changed
- what attack paths were closed
- what is still open
```

## Packet B: Live-Contract Prompt

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Goal: remove deceptive mock/demo success paths from production-facing operator flows.

Own these files:
- app/briefs/page.tsx
- lib/briefs/snapshot-safe.ts
- lib/ai/provider-adapter.ts
- components/dashboard-provider.tsx
- components/auth/user-menu.tsx

Tasks:
- `/briefs` should prefer real data paths and show explicit degraded/empty states instead of hardcoded demo briefs.
- AI provider failure should not silently become a fake successful run.
- Dashboard should not silently serve stale/mock state after auth failure, and sign-out should clear user-specific cached dashboard state.

Validation:
- narrow local checks first
- then `npm run build`

Return:
- files changed
- where demo fallback was removed or quarantined
- any remaining degraded paths that still need a product decision
```

## Packet C: Data/API Scoping Prompt

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Goal: move the app from single-tenant illusion toward honest scoped data access.

Own these files:
- prisma/schema.prisma
- app/api/projects/**
- app/api/tasks/**
- app/api/risks/**
- app/api/team/**
- any directly related service/helper files you must touch

Tasks:
- Audit where core project/task/risk/team APIs are globally unscoped.
- Introduce the smallest coherent organization/workspace scoping model that matches current auth/membership data.
- Do not fake multi-tenancy; if full tenant isolation is too large, make the code explicit about current scope and prevent misleading claims.
- Keep auth consistent across list and mutation routes.

Validation:
- Prisma generation
- targeted tests if added
- `npm run build`

Return:
- schema/query changes
- what is now truly scoped
- what still remains before honest multi-tenant claims
```

## Packet D: Desktop App Prompt

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Goal: finish the desktop delivery path from Tauri scaffold to a repeatable app build.

Own these files:
- src-tauri/**
- docs/desktop-setup.md
- only the minimal web build/config files needed to make desktop packaging coherent

Current baseline:
- Tauri v2 scaffold exists and `cargo check` passes.
- The remaining blocker is packaging against a real frontend output instead of an SSR-style `.next` target.

Tasks:
- Decide the safest desktop delivery model for this repo: local webview against dev server, static export, or packaged server companion.
- Implement the smallest coherent path that can actually run or build repeatably.
- Update setup docs with exact commands and known OS requirements.

Validation:
- `cargo check`
- the narrowest runnable desktop command you can validate

Return:
- files changed
- what command now works
- what still blocks signed/distributed desktop builds
```

## Packet E: Phone App Prompt

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Goal: deliver a real phone-ready path, not just vague “mobile support”.

Own these files:
- app/layout.tsx
- components/pwa-registrar.tsx
- public/**
- docs/mobile-app.md
- if needed, a new isolated mobile shell folder with its own config, but do not disturb the main web app without cause

Current baseline:
- PWA installability has already been improved.
- There is not yet a true store-distributed mobile package.

Tasks:
- Keep the PWA install path strong and honest.
- Decide whether the next step should be Capacitor shell, Tauri mobile, or “PWA only for now”.
- If you implement a shell, keep it isolated and document the workflow clearly.
- Avoid claiming native push/background features unless they truly exist.

Validation:
- `npm run build`
- any shell-specific validation you add

Return:
- files changed
- whether the result is PWA-only or an actual mobile shell
- the exact remaining gap to App Store / Google Play readiness
```

## Packet F: Launch Audit Prompt

```text
Work in /Users/aleksandrgrebeshok/ceoclaw-dev.

Goal: convert the repo into an honest release-candidate checklist.

Own these files:
- RUNBOOK.md
- README.md
- DEPLOY.md
- PROJECT_STATUS.md
- optional new docs under docs/launch-audit.md

Tasks:
- Verify build, auth, settings, CRUD, AI, briefs, desktop path, and mobile path against the current codebase.
- Remove any launch claims that are still aspirational.
- Write a short release checklist with pass/fail criteria and rollback notes.

Return:
- updated docs
- red flags still blocking launch
- exact go/no-go recommendation
```
