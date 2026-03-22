# CEOClaw Prompt Memo - 2026-03-20

Use this as the current handoff prompt for the next implementation session.

## Current state

- The multi-agent runtime is integrated into the product.
- AI run traces are replayable and comparable.
- The public `/release` hub is live and smoke-tested.
- Web, desktop, and iPhone shells are present.
- Build, vitest, the release smoke, and the macOS release path are green.
- `npm run release:desktop` now produces a signed macOS DMG locally.
- `npm run release:publish:desktop` publishes the DMG to GitHub Releases at `https://github.com/alexgrebeshok-coder/ceoclaw/releases/tag/v1.0.0`.
- The release hub can derive the desktop download URL from the published GitHub release even when the explicit desktop env var is missing.
- `.env.example` now contains a usable local-startup baseline instead of an empty file.
- `npm run release:mobile` is guarded and will fail fast on machines that only have Command Line Tools; a full Xcode install is required for the iPhone archive path.
- The current execution route lives in `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md`.

## Next priorities

1. Keep the macOS artifact surfaced in the release flow and wire the deployed env to the same GitHub Release URL when ready.
2. Finish the real distribution path for iPhone on a machine with full Xcode.
3. Keep the release hub honest by pointing it at real artifacts whenever those URLs exist.
4. Only continue runtime durability work if it directly improves operator trust or installability.
5. Trim lint debt only after release blockers are gone.

## Operating rules

- Update `README.md` whenever launch-critical behavior changes.
- Update the canonical plans whenever a stage is completed or re-scoped.
- Prefer thin shells over rewrites.
- Prefer honest failure modes over demo/mock fallback behavior.
- Keep the product boring to install and obvious to open.

## Expected output from the next session

- files changed
- validation performed
- open blockers, if any
