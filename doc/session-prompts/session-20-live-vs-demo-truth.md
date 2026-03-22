# Session 20: Live-vs-Demo Truth in Operator UX

## Goal

Remove ambiguity between live and simulated product state across the main operator workflows.

This session must produce a working end-to-end flow:

`server runtime mode -> truth helper -> shared operator truth card -> safe page and API behavior`

## Scope

Work only in the runtime truth slice:

- `lib/server/**`
- selected operator pages in `app/**`
- shared presentation in `components/layout/**`
- the narrow route guards needed to stop demo mode from touching live delivery workflows
- focused unit coverage only

> Примечание: производственный runtime теперь всегда live. Флаг `APP_DATA_MODE` оставлен только в `docs/mock-data.md` для тех, кто восстанавливает демо-поток.

## Product intent

The product now has live connector probes, read-only enterprise facts, evidence, trace, and escalation queueing.

Without an explicit truth layer, operators still have to guess:

1. whether a page is backed by live database facts or demo data;
2. whether a connector sample is real while page context is simulated;
3. whether a delivery workflow is actually safe to use in demo mode.

This session should make that visible and enforceable.

## Requirements

1. Add a shared runtime truth helper and one reusable operator truth component.
2. Surface runtime truth on the key operator pages:
   - `/integrations`
   - `/work-reports`
   - `/briefs`
3. Support four honest truth states:
   - `live`
   - `demo`
   - `mixed`
   - `degraded`
4. Make the (now legacy) demo mode safe for live delivery workflows:
   - `/api/work-reports` should not touch live DB while `APP_DATA_MODE=demo` (legacy demo instructions live in `docs/mock-data.md`)
   - `/api/escalations` should not expose live operator backlog while `APP_DATA_MODE=demo`
5. Keep external connector reads explicit:
   - connector probes may still be live while page context is demo;
   - the UI must say that clearly.
6. Keep degraded behavior explicit when live mode is requested but DB-backed facts are unavailable.

## Constraints

1. Do not introduce a second runtime-mode system.
2. Do not spread truth messaging across every page in the product.
3. Do not silently fall back from explicit live mode to demo facts.
4. Do not change connector semantics that are already honest on their own.
5. Prefer one consistent operator truth layer over many local copy tweaks.

## Verification

Minimum verification:

1. `npm run test:unit`
2. `npm run build`
3. Runtime smoke:
   - live server: `/integrations`, `/work-reports`, `/briefs`
   - demo server: `/work-reports`, `/api/work-reports`, `/api/escalations`, `/integrations`, `/briefs`

## Done when

This session is done when an operator can tell whether a page is live, demo, mixed, or degraded without guessing, and demo mode no longer allows live delivery workflows to appear usable.
