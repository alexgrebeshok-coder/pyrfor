# ARCHIVED

**Status: FROZEN — Historical Reference Only**

The contents of this directory are frozen experimental modules from wave experiments (waves 7–22, 2026-Q1). They were never wired into any active product code path and are **excluded from `tsconfig.json` and `vitest.config.ts`** to keep the build graph honest.

## What this means

- **Do not import** any file from this directory in production code.
- **Do not modify** existing files here; they are a historical snapshot.
- **Do not add** new files here; new runtime modules go in `packages/engine/src/runtime/` only when connected to a real product feature.

## To unarchive a module

```bash
git mv _archive/foo.ts ../foo.ts
git mv _archive/foo.test.ts ../foo.test.ts
# Then add the import at the actual call site and update tsconfig/vitest as needed.
```

## Contents (49 modules)

See `README.md` in this directory for the full per-module inventory and salvage notes.
