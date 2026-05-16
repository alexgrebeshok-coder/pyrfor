# Release and distribution

## npm (`@pyrfor/engine`)

Publishing runs via [`.github/workflows/publish-engine.yml`](../.github/workflows/publish-engine.yml) on release tags and manual dispatch.

### Required secret: `NPM_TOKEN`

1. Create an npm automation token with **publish** scope for the `@pyrfor` org.
2. Add repository secret `NPM_TOKEN` in GitHub → Settings → Secrets → Actions.
3. Trigger publish (release tag or workflow dispatch) and verify:

```bash
npx @pyrfor/engine@latest concept "hello" --version
```

Without `NPM_TOKEN`, CI may build artifacts but **will not publish** to the public registry.

## Desktop (Tauri) signed releases

### macOS

- **Developer ID Application** certificate in Apple Developer account.
- Export signing identity to `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` (or use `tauri signer` with stored key).
- **Notarization**: `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` for `notarytool` after `cargo tauri build`.
- Staple the notarized app before uploading to GitHub Releases.

### Windows

- Code signing certificate (EV recommended for SmartScreen reputation).
- Set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for Tauri updater bundles.

### Linux

- AppImage or `.deb` from CI; GPG-sign release assets when distributing outside GitHub.

### Tauri updater

- Generate updater keys once: `pnpm tauri signer generate -w ~/.tauri/pyrfor.key`.
- Store **public** key in `tauri.conf.json` (`plugins.updater.pubkey`).
- Store **private** key only in CI secrets for release workflows.

See [Tauri — signing](https://v2.tauri.app/distribute/sign/) and [updater](https://v2.tauri.app/plugin/updater/) for current CLI flags.

## Pre-release checklist

```bash
pnpm test
pnpm release:check
pnpm swe-bench:smoke
```
