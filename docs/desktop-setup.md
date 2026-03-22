# Desktop setup

The Tauri v2 baseline lives under `src-tauri/` and now wraps the live production web app instead of bundling the full Next.js server build.

## Prerequisites

1. Install Node dependencies from the repo root.
2. Make sure a Rust stable toolchain is installed via `rustup`.
3. On macOS, install the Xcode command line tools if you want to bundle a `.dmg`.

## Runtime model

The desktop app loads a small generated shell page at build time and then redirects into the live web app URL.
This is a thin live-web wrapper, not a self-contained desktop client.
The main window now also remembers its last size and position through the Tauri window-state plugin, so reopening the app restores the previous desktop layout automatically.

1. Set `NEXT_PUBLIC_APP_URL` to the production HTTPS URL for CEOClaw.
2. `npm run build:desktop-shell` generates `src-tauri/desktop-shell-dist/index.html` from that URL.
3. `tauri:dev` still points at `http://localhost:3000` for local web development.

## Local AI on desktop

The desktop app can auto-start a local MLX server through the Tauri bridge when local mode is selected.
This gives you an out-of-the-box path for the fine-tuned CEOClaw adapter on a MacBook or Mac mini.
If the AI workspace is left in `auto`, desktop resolves it to `local` so the local model is the first-choice path.

Recommended defaults:

```bash
CEOCLAW_MLX_HOST=127.0.0.1
CEOCLAW_MLX_PORT=8080
CEOCLAW_MLX_MODEL_PATH=/Users/you/.openclaw/models/qwen-3b-mlx
CEOCLAW_MLX_ADAPTER_PATH=/Users/you/.openclaw/workspace/models/qwen-ceoclaw-lora-v7
CEOCLAW_MLX_AUTO_START=true
```

The settings page will show `Local model` when the Tauri bridge is active, and the app will warm up the local server on desktop launch or first AI request.

## Run locally

1. Start the web app with `npm run dev`.
2. Start the desktop shell with `npm run tauri:dev`.
3. Tauri uses the root `npm run dev` process as its dev webview target.

## Build

1. Set `NEXT_PUBLIC_APP_URL` before building the desktop app.
2. Run `npm run release:desktop` to preflight and build the macOS package.
3. Run `npm run release:publish:desktop` to create or update the GitHub Release with the signed DMG.
4. If you only want to inspect the target state, run `npm run release:status`.
5. On macOS, you still need a signing identity and notarization flow for real external distribution.
6. The repo does not automate Gatekeeper release prep yet, so treat the output as an internal or staging bundle until signing is wired in.
7. Window geometry is persisted automatically; if you need to reset it, remove the Tauri app config state file for the desktop bundle.

If `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` is unset, the release page derives the GitHub Releases DMG URL from the current Tauri version.

## Notes

The desktop shell is intentionally static and lightweight. It exists only to show a branded loading state and hand off to the live web app URL at build time, which keeps the bundle small and avoids shipping the full Next.js server runtime inside Tauri.
If you need a true offline desktop client, that is a separate product track.
