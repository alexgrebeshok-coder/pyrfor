# CEOClaw iPhone On-Device AI Future Track

**Date:** 2026-03-20  
**Status:** Future track, not launch-critical  
**Depends on:** current web core, iPhone shell, local AI abstractions, release stability

This document captures the separate future branch for putting AI on the iPhone itself.
It is intentionally not part of the current release finish line.

## 1. Why this is separate

The current iPhone product is a thin live-web shell.
That is the right launch path for reliability, installability, and shared state.

On-device AI for iPhone is a different engineering problem:

- different runtime constraints;
- smaller memory and battery budgets;
- tighter thermal limits;
- different packaging and model formats;
- different UX expectations for latency and offline behavior.

We should not mix this with the launch-critical desktop MLX work or with the current iPhone shell release path.

## 2. Product goal

Make iPhone AI useful even when users are away from the desktop and want lightweight, local-first help.

The target outcome is not "full desktop council on phone".
The target outcome is:

- fast summaries;
- task extraction;
- note-to-action conversion;
- short answers;
- limited offline assistance for high-value micro workflows;
- graceful fallback to live AI when the on-device model is not enough.

## 3. Recommended product shape

The safest shape is a hybrid model:

- web and desktop continue to use the full product core and live council runtime;
- iPhone keeps the thin live-web shell for the main product;
- iPhone on-device AI appears as a separate mode for selected micro tasks;
- if the on-device model cannot answer confidently, the app falls back to live gateway/provider AI.

This avoids turning the phone into a second product.

## 4. Candidate runtime options to evaluate

We should evaluate a small number of iOS-native inference paths, not all of them at once:

- Core ML-based execution for Apple-friendly packaging;
- llama.cpp-style local runtime for quantized models;
- MLC/other mobile inference stacks if they fit the device constraints;
- a very small distilled or quantized model for summaries and triage.

The important constraint is not brand name.
The important constraint is: can it ship, start quickly, and stay within mobile limits.

## 5. Scope for v1 of this future track

### Include

- local summary and triage for short prompts;
- task suggestion from notes or messages;
- quick answer / clarification assistant;
- offline-safe "what should I do next?" helper;
- a clear UI mode switch that tells the user when the phone is using local AI.

### Exclude

- full desktop council parity;
- large context reasoning;
- heavy agent orchestration on device;
- replacing the shared web product core;
- requiring on-device AI for launch.

## 6. Proposed implementation stages

### Stage A. Feasibility

Goal: confirm a mobile runtime can run a small model with acceptable latency and battery use.

Deliverables:

- runtime shortlist;
- model size target;
- cold-start and warm-start benchmarks;
- device compatibility notes.

Exit criteria:

- we know which runtime is viable on actual target iPhones;
- we know what prompts the model can handle well.

### Stage B. Mobile AI contract

Goal: define a narrow contract for phone-local AI.

Deliverables:

- prompt types;
- output schema;
- confidence/fallback rules;
- error states and retry behavior;
- privacy boundaries.

Exit criteria:

- the phone AI never pretends to do more than it can;
- users can see when local AI is being used.

### Stage C. UX integration

Goal: place mobile AI where it helps, not everywhere.

Deliverables:

- a phone-safe composer or quick action surface;
- summary / triage / capture actions;
- clear fallback to live AI;
- settings copy that explains the tradeoff.

Exit criteria:

- the feature is discoverable;
- the feature is easy to ignore when not needed;
- the normal iPhone shell still feels clean.

### Stage D. Guardrails and testing

Goal: keep the feature honest and stable.

Deliverables:

- device tests;
- accuracy sanity checks on the target workflows;
- latency checks;
- battery/thermal notes;
- fallback tests.

Exit criteria:

- no silent failures;
- no confusing partial states;
- the app clearly says when it is local-only versus live AI.

## 7. Success criteria

We can call this track successful when:

- the iPhone app offers a real local AI mode for a limited set of tasks;
- the feature is clearly labeled and safe to ignore;
- the core product still works without it;
- the current launch path remains untouched;
- users get meaningful value without needing a desktop nearby.

## 8. Relationship to the current launch plan

This track is future work.
It must not block:

- desktop release;
- iPhone shell release;
- release center publication;
- web product polish;
- current AI council and trace work.

## 9. Handoff prompt

When this becomes active work, use a prompt that owns the mobile inference choice, the device benchmark, and the narrow UX surface.
Do not let it silently expand into a rewrite of the iPhone app.
