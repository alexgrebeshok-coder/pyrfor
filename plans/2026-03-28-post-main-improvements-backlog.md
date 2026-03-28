# Post-main improvements backlog

Use this file for ideas that show up while finishing the main version, but should land only after the current release-critical slice is done.

## 2026-03-28

- Auto-sync `NEXT_PUBLIC_IOS_DOWNLOAD_URL` from the chosen App Store Connect / TestFlight handoff so the release hub does not depend on manual env edits.
- Add a release-ops smoke that validates the public `/release` page against the deployed environment, not only local preview.
- Automate desktop notarization and env propagation so the GitHub Release asset URL becomes the default public macOS channel without manual follow-up.
- Clear the current repo-wide production build blockers outside the release slice (`app/api/ai/stream/route.ts` typing and missing AI deps) so `npm run release:smoke` can stay fully green in production mode.
