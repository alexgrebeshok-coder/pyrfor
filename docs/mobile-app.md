# Mobile app

CEOClaw's iPhone path is a thin Capacitor shell around the same live Next.js product surface.
It is intentionally small: the app opens a generated loading page from the native bundle, then redirects into the live web app URL.

## What it gives us

- native iPhone bundle with its own bundle id;
- shared auth, data, calendar, tasks, projects, and AI surfaces;
- safe-area aware shell and mobile-first navigation;
- a release path that can point at localhost for simulator/dev or HTTPS production for TestFlight/App Store.

## Build flow

1. Set `NEXT_PUBLIC_APP_URL` to the target web app URL.
2. Run `npm run release:mobile` to preflight and build the iPhone package. This requires full Xcode; Command Line Tools alone will stop at the archive/build gate with a clear error.
3. If you only want the shell and sync step, run `npm run build:mobile-shell` and then `npm run mobile:ios:sync`.
4. Open the Xcode project with `npm run mobile:ios:open`.
5. Build or run from Xcode on the simulator or a connected iPhone.

## Local development

- Use `http://localhost:3000` as `NEXT_PUBLIC_APP_URL` when you want the shell to point at the local Next dev server.
- Start the web app with `npm run dev`.
- Regenerate the mobile shell and sync Capacitor if the target URL changes.
- The native iOS bundle includes a narrow ATS local-networking exception so simulator/dev flows can reach `localhost` without opening broader insecure-load exceptions.
- `npm run mobile:ios:build`, `npm run mobile:ios:run`, and `npm run mobile:ios:open` all expect a full Xcode installation on macOS.

## Release notes

- The iPhone shell is a live-web wrapper, not a separate React Native rewrite.
- If the app needs offline-first behavior beyond the existing PWA surface, that should be a separate product track.
- On-device AI for iPhone is also a separate future track, documented in [plans/2026-03-20-iphone-on-device-ai-future-track.md](plans/2026-03-20-iphone-on-device-ai-future-track.md).
