# CEOClaw dashboard visual baseline

Date: 2026-03-28
Status: locked baseline

## Purpose

This document locks the accepted dashboard visual baseline so it is not treated as an optional variation.

The approved dashboard is the main surface shown on the local baseline screen at `http://localhost:3003/` during the accepted review on 2026-03-28.

## What is locked

The dashboard entry surface at `/` must keep all of these together on the first screen:

- the `Панель управления` heading and `Центр управления портфелем` eyebrow;
- the compact KPI row at the top;
- the `Карта и логистика` card on the main dashboard;
- the live map on the left side of that card;
- the `Активные контуры` side column on the right side of that card;
- the `Открыть карту` action that drills into `/field-operations`.

This is not a temporary mock and not an interchangeable layout.
It is the canonical dashboard entry visual until the user explicitly approves a replacement.

## Non-negotiable rules

- Do not replace the dashboard map block with a smaller summary-only card.
- Do not move the main map out of the dashboard first screen unless the user explicitly asks for that change.
- Do not downgrade `Активные контуры` into a flat location list.
- Do not treat the public `/demo` screen as the visual reference for the authenticated dashboard.
- Do not introduce an alternate dashboard layout without explicit approval from the user.

## Data contract

The dashboard map block must stay bound to live dashboard data:

- map markers come from current project locations;
- `Активные контуры` comes from current projects plus current attention signals;
- the map card remains a summary surface for the field contour, not a fake decorative panel.

## Verification

Any change to the dashboard must preserve:

- `data-testid="dashboard-map"`
- visible `Карта и логистика` text
- visible `Активные контуры` text
- visible `Открыть карту` action

The automated smoke and dashboard navigation specs should keep checking this baseline.

## Where it is implemented

- [dashboard-home.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/dashboard/dashboard-home.tsx)
- [field-map-canvas.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/field-operations/field-map-canvas.tsx)
- [field-map-tab.tsx](/Users/aleksandrgrebeshok/ceoclaw-dev/components/field-operations/field-map-tab.tsx)

## Change policy

If the dashboard visual is ever changed again:

1. the user must explicitly approve the new layout;
2. this document must be updated in the same change;
3. the smoke test must be updated only if the new baseline is explicitly accepted.

