# Pyrfor IDE

> A fast, native macOS IDE built with Tauri 2 + Vite/React + Monaco Editor.  
> AI-powered streaming chat · PTY terminal · Git UI · Auto-updates.

---

## Table of Contents

1. [Overview](#overview)
2. [System Requirements](#system-requirements)
3. [Install](#install)
4. [Build from Source](#build-from-source)
5. [Architecture](#architecture)
6. [Development Workflow](#development-workflow)
7. [Troubleshooting](#troubleshooting)
8. [Release Process](#release-process)
9. [Auto-Updater](#auto-updater)

---

## Overview

Pyrfor IDE is a macOS-native developer tool at the level of Cursor / Zed / Claude Code.  
It wraps the **`packages/engine` Node.js runtime** (Pyrfor daemon) inside a **Tauri 2 shell**, giving you:

| Feature | Implementation |
|---|---|
| Monaco Editor (offline, no CDN) | `@monaco-editor/react` |
| Streaming AI chat with multi-file context | SSE → `packages/engine` |
| PTY terminal (vim/htop/fzf/nvim) | `node-pty` sidecar |
| Git UI (stage / commit / diff) | `shell-exec git` sidecar |
| Workspace persistence | `tauri-plugin-window-state` + localStorage |
| Settings & secrets | macOS Keychain via `keyring` crate (Phase E1) |
| Auto-updates | `tauri-plugin-updater` + GitHub Releases |

---

## System Requirements

- **macOS 13 Ventura or later** (Apple Silicon / arm64)
- 4 GB RAM minimum; 8 GB recommended
- ~100 MB disk for the app bundle

---

## Install

1. Download `Pyrfor-x.y.z-aarch64.dmg` from the [Releases](https://github.com/pyrfor-dev/pyrfor-ide/releases) page.
2. Open the DMG, drag **Pyrfor.app** to your **Applications** folder.
3. Double-click to launch.

> **First launch on an unsigned build:** macOS Gatekeeper may block the app.  
> See [Troubleshooting → Gatekeeper](#gatekeeper-unsigned-warning) below.

---

## Build from Source

### Prerequisites

| Tool | Version |
|---|---|
| macOS | 13+ (Apple Silicon) |
| Xcode Command Line Tools | 15+ (`xcode-select --install`) |
| Rust (stable) | 1.77+ (`rustup update stable`) |
| Node.js | 22 (`nvm install 22`) |
| npm | 10+ (bundled with Node 22) |

### Steps

```bash
# 1. Clone
git clone https://github.com/pyrfor-dev/pyrfor-ide.git
cd pyrfor-ide

# 2. Install root JS deps
npm ci

# 3. Build engine
cd packages/engine && npm run build && cd ../..

# 4. Install web deps
cd apps/pyrfor-ide/web && npm ci && cd ../../..

# 5. Build sidecar binary
cd apps/pyrfor-ide && npm run build:sidecar && cd ../..

# 6. Build the app
cd apps/pyrfor-ide/src-tauri
cargo tauri build --bundles dmg,app
# → DMG at target/release/bundle/dmg/Pyrfor-*.dmg
```

---

## Architecture

```
┌─ Pyrfor.app (Tauri 2 shell — Rust thin wrapper) ─────────────────────┐
│                                                                        │
│  WKWebView                                                             │
│   └── apps/pyrfor-ide/web/dist/   (Vite production)                   │
│       ├── React 18 + TypeScript                                        │
│       ├── Monaco Editor (npm, offline)                                 │
│       ├── xterm.js PTY terminal                                        │
│       └── Components: FileTree · Tabs · Editor · Chat                 │
│                       Terminal · GitPanel · UpdateNotifier             │
│                                                                        │
│  Rust core  (minimal)                                                  │
│   ├── Window + tray + native menu                                      │
│   ├── Sidecar lifecycle (spawn / restart / kill)                       │
│   ├── tauri-plugin-shell     (Open in Finder)                          │
│   ├── tauri-plugin-window-state (persist bounds)                       │
│   ├── tauri-plugin-updater   (auto-update)                             │
│   └── keyring crate          (macOS Keychain, Phase E1)                │
│                                                                        │
│  Sidecar: pyrfor-daemon                                                │
│   ├── Node 22 + packages/engine/dist/                                  │
│   ├── HTTP gateway :0 (random port, written to stdout)                 │
│   └── Endpoints: /api/fs/* · /api/chat/stream · /api/pty/* · /api/git │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Development Workflow

```bash
# Terminal 1 — start Vite dev server
cd apps/pyrfor-ide/web && npm run dev

# Terminal 2 — start Tauri in dev mode
cd apps/pyrfor-ide/src-tauri && cargo tauri dev

# Run tests
cd packages/engine && npx vitest run        # 3788+ engine tests
cd apps/pyrfor-ide/web && npm test -- --run  # web component tests
```

### Updater in dev

The updater plugin is configured with `"active": false` in `tauri.conf.json` so that
`cargo tauri dev` works without a valid pubkey or network endpoint.  
To test updates locally, set `"active": true` and point `endpoints` at a local server.

---

## Troubleshooting

### Gatekeeper unsigned warning

Until the Apple Developer ID certificate is provisioned and CI signing is enabled,
downloaded builds are **unsigned**. macOS will show:

> _"Pyrfor" can't be opened because Apple cannot check it for malicious software._

**Workaround:**
1. Right-click (Control+click) `Pyrfor.app` in Applications.
2. Select **Open** from the context menu.
3. Click **Open** in the dialog.

This only needs to be done once per machine. Once signing is wired (see
[Release Process](#release-process)), Gatekeeper will pass automatically.

### App won't start / sidecar crash

Open Console.app, filter by "pyrfor", and inspect sidecar logs.  
Common cause: missing `_runtime` directory (Node binary) inside the app bundle — run
`npm run build:sidecar` before `cargo tauri build`.

---

## Release Process

See [`RELEASE.md`](../../RELEASE.md) at the repository root for the full runbook.

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | **Required.** Content of `apps/pyrfor-ide/.tauri/updater.key` |
| `APPLE_SIGNING_IDENTITY` | Optional. Your Developer ID Application identity string |
| `APPLE_CERTIFICATE_P12` | Optional. Base64 of exported `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Optional. Password for the `.p12` |
| `APPLE_ID` | Optional. Apple ID email for notarization |
| `APPLE_TEAM_ID` | Optional. Apple Developer Team ID |
| `APPLE_PASSWORD` | Optional. App-specific password for notarization |

When `APPLE_SIGNING_IDENTITY` is **not set**, the CI still runs and produces unsigned
artifacts — a warning is printed in the workflow log.

---

## Auto-Updater

Pyrfor uses `tauri-plugin-updater` with a **GitHub Releases** endpoint.

### How it works

1. On each app launch, `UpdateNotifier.tsx` calls `check()` from `@tauri-apps/plugin-updater`.
2. If an update is available, a toast appears: **"Pyrfor vX.Y.Z available — Restart to update"**.
3. Clicking **Install** calls `downloadAndInstall()` then `relaunch()`.
4. Updates are cryptographically verified against the public key in `tauri.conf.json`.

### Update manifest format

The `latest.json` file (uploaded as a Release asset by CI) has this shape:

```json
{
  "version": "1.0.0",
  "notes": "Release notes…",
  "pub_date": "2026-01-15T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<minisign signature string>",
      "url": "https://github.com/pyrfor-dev/pyrfor-ide/releases/download/v1.0.0/Pyrfor.app.tar.gz"
    }
  }
}
```

### Setting the private key for releases

The private key is in `apps/pyrfor-ide/.tauri/updater.key` (gitignored).  
Add its contents as `TAURI_SIGNING_PRIVATE_KEY` in GitHub Actions secrets:

```bash
cat apps/pyrfor-ide/.tauri/updater.key | pbcopy  # copies to clipboard
# → paste into: GitHub repo → Settings → Secrets → Actions → TAURI_SIGNING_PRIVATE_KEY
```

The corresponding **public key** is already committed in `tauri.conf.json → plugins.updater.pubkey`.
