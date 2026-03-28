# Post-main improvements backlog

Use this file for ideas that show up while finishing the main version, but should land only after the current release-critical slice is done.

## 2026-03-28

- Auto-sync `NEXT_PUBLIC_IOS_DOWNLOAD_URL` from the chosen App Store Connect / TestFlight handoff so the release hub does not depend on manual env edits.
- Add a release-ops smoke that validates the public `/release` page against the deployed environment, not only local preview.
- Automate desktop notarization and env propagation so the GitHub Release asset URL becomes the default public macOS channel without manual follow-up.
- Decouple `npx tsc --noEmit` from stale `.next/types` state so a clean typecheck does not depend on running a full Next build first.
- Resolve the current production build warning from `lib/ai/agent-loader.ts` so client bundles do not try to pull `fs/promises`.
- Resolve the optional `js-tiktoken` bundling warning in `lib/ai/cost-tracker.ts` while keeping the runtime fallback path intact.
- Fix the chart container sizing warnings during static generation so release builds stay signal-clean.
- Remove the build-time Telegram webhook warning by either wiring `TELEGRAM_BOT_TOKEN` in production or suppressing the warning when Telegram delivery is intentionally disabled.
- Add visual regression baselines for `/`, `/projects`, `/tasks`, and `/analytics` so the accepted shell and dashboard layout cannot drift during later iterations.
- Extract a shared filter-and-actions toolbar for `projects`, `tasks`, and `analytics` so page-level polish stays consistent without repeating layout code.
- Audit long-lived client requests on pages like `/analytics` and `/briefs` so browser verification can use stricter completion rules without false hangs.
