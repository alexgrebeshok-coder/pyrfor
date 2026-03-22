# CEOClaw Field Operations and Map Hub Plan

Updated: 2026-03-20

This plan turns the original "office + field + equipment + personnel" roadmap into one user-facing hub inside CEOClaw.

The goal is not to build a heavy GIS product.
The goal is to give field-heavy teams one place where they can understand sites, people, equipment, geofences, recent events, and visual evidence without jumping across several unrelated screens.

## 1. Why this is needed

The original roadmap already asked for:

- office monitoring;
- field monitoring;
- equipment tracking;
- personnel GPS tracking;
- camera / visual evidence correlation;
- photo reports with geotags;
- voice-to-project input from the field.

CEOClaw already has the raw ingredients:

- GPS telemetry truth;
- work reports and signal packets;
- video facts;
- enterprise truth and reconciliation;
- risks and escalation queues;
- project and team surfaces.

What is still missing is a single human-friendly surface that makes those parts feel like one operational system.

## 2. Product decision

Recommended structure:

### Option A. Put maps inside Analytics

Pros:

- fastest to ship;
- reuses existing charts.

Cons:

- makes the map feel like a chart, not an operational center;
- mixes field operations with budget analytics;
- harder for users to form a clear mental model.

### Option B. Create one dedicated `Поля и логистика` hub

Pros:

- matches the original roadmap language;
- keeps map, people, equipment, geofences, events, and media together;
- gives field users one obvious entry point;
- can stay honest when data is partial or anchor-based.

Cons:

- adds one more top-level hub;
- needs careful UX so it does not become a dump of tables.

### Option C. Split into several routes immediately

Pros:

- maximum modularity.

Cons:

- too fragmented for launch;
- too many places to learn;
- harder to keep the experience readable.

## 3. Chosen direction

We should ship Option B first:

- one top-level hub named `Поля и логистика`;
- one page with internal tabs;
- one map that starts with curated operational anchors and later accepts live coordinates from GPS providers;
- one set of supporting tabs for people, equipment, geofences, events, and photo/video facts.

This is the most usable path for the current stage of CEOClaw.

## 4. Information architecture

### Top-level route

- `Поля и логистика` -> `/field-operations`

### Tabs inside the hub

- `Карта`
- `Люди`
- `Техника`
- `Геозоны`
- `События`
- `Фото и видео`

### What each tab answers

- `Карта`: where the active sites are and what is happening on them.
- `Люди`: who is assigned, who is overloaded, and where the team coverage is thin.
- `Техника`: which assets are active, idle, or linked to the latest telemetry.
- `Геозоны`: which zones are live, how much activity they see, and where attention is needed.
- `События`: what changed recently, what needs review, and what should be escalated.
- `Фото и видео`: what the visual evidence says and how trustworthy it is.

## 5. Data model strategy

Launch phase:

- keep the hub read-only;
- use project locations and geofence names as operational anchors;
- show a clear note when a location does not yet have a map anchor;
- derive markers from already known project and GPS truth.

Later phase:

- accept real lat/lng from GPS providers;
- add route paths and equipment tracks;
- add geofencing overlays;
- add time-window playback.

## 6. Map strategy

For launch, prefer a provider-aware map stack:

- `Яндекс.Карты` as the preferred provider when `NEXT_PUBLIC_YANDEX_MAPS_API_KEY` is present, loaded lazily inside the field hub so the rest of the app stays interactive;
- `MapLibre GL JS` with OpenStreetMap tiles as the fallback path when Yandex is unavailable or fails to load.
- if live operator data is not available, seed the hub with the shipped preview project locations so the map still opens with useful city/site points instead of an empty canvas.

Why:

- Yandex feels more natural for Russian-speaking field teams and keeps the UI aligned with the rest of CEOClaw;
- no vendor lock-in when the fallback is used;
- the fallback stays privacy-friendly and live-first;
- the user still gets the same field-truth model if the Yandex key is missing;
- keeps the map independent from the analytics charts.

The map should not pretend to be more precise than the data allows.
If a location is only a configured anchor, the UI should say so.

## 7. UX principles

- Russian-first labels in the visible UI.
- Put the map above the supporting metrics so the first screen shows the working surface first.
- One tab = one user question.
- Map first, details in cards and drawers.
- Quick filters should let users switch between all markers, площадки, геозоны, live, watch, and pending states.
- Selecting a marker from the side panel should focus the map on that site and keep the selected card visually highlighted.
- Use concise labels, no deep submenus.
- Show what is known, what is missing, and what is still only an anchor.
- Make the field hub comfortable on desktop and mobile.
- Show the active map provider clearly so the user understands the current capability level.

## 8. Integration points

The hub should connect back into the existing app:

- Projects should link to the map when they have a location.
- Work reports should feed the `События` tab.
- GPS telemetry should feed `Техника` and `Геозоны`.
- Video facts should feed `Фото и видео`.
- Escalations should surface in `События`.
- AI chat should be able to answer field questions such as:
  - `Покажи участки на карте`
  - `Какая техника простаивает`
  - `Какие геозоны активны`
  - `Что изменилось на площадке`

## 9. Recommended release slices

### Slice 1

- add `/field-operations`;
- add `Карта`, `Люди`, `Техника`, `Геозоны`, `События`, `Фото и видео` tabs;
- use curated anchors and live truth slices;
- add a Russian-first header and summary cards.

### Slice 2

- add map zoom / focus interaction;
- add quick filter chips for live status and marker kind;
- add marker focus buttons in the side rail;
- link project cards into the field hub;
- add more precise anchor resolution;
- improve mobile affordances.

### Slice 3

- support live GPS coordinates;
- draw movement paths and zone overlays;
- add photo pinning and playback;
- add voice / event / photo correlation.

## 10. Acceptance criteria

The hub is good enough when:

- a user can open one place and understand the field situation in under a minute;
- map, people, equipment, geofences, events, and media are all visible from one hub;
- the UI remains honest about missing anchors or missing live coordinates;
- the page is readable and comfortable on desktop and mobile;
- the page meaningfully reuses current CEOClaw data instead of inventing a second system.
