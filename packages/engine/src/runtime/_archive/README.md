# `_archive/` — experimental runtime modules

These modules were built across "wave" experiments (waves 7–22, 2026-Q1) but were
**never wired into any product code path** — no import from `app/`, `components/`,
`lib/`, `daemon/`, `apps/`, or `runtime/index.ts`.

They are kept on disk as a salvage library: the code is reasonable, the tests
are green, and a future feature might pull one out and wire it. But they are
**excluded from `tsc --noEmit` and `vitest run`** to keep the build graph honest.

## Rules

1. **Do not add new files here.** New runtime modules go in
   `packages/engine/src/runtime/` only when wired to a real product feature.
2. **To unarchive a module:** `git mv _archive/foo.ts ../foo.ts`,
   `git mv _archive/foo.test.ts ../foo.test.ts`, then add the import where
   it's actually used. Update `tsconfig.json`/`vitest.config.ts` if needed.
3. **Reference:** `plans/pyrfor-finish-plan.md` §2 has the per-module verdict.

## Inventory (27 modules)

agent-registry, backup-scheduler, cron-builder, crypto-keystore,
diff-syncer, file-watcher, graph-utils, http-client, image-cache,
json-rpc-server, localization-bundle, markdown-table, otp-totp,
plugin-loader, priority-queue, prompt-template, queue-scheduler,
snapshot-store, structured-logger, subprocess-pool, tar-bundler,
tokenizer-bpe, tool-router, translator-router, voice-output,
webhook-receiver, websocket-bridge.
