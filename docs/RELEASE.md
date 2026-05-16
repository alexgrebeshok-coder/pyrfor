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

## Desktop signing: three different systems

These are **not interchangeable**. A release can use all three on macOS.

| Mechanism | Secret(s) | What it signs | Consumer trust |
| --- | --- | --- | --- |
| **Tauri updater (minisign)** | `TAURI_SIGNING_PRIVATE_KEY`, optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `*.app.tar.gz` + `latest.json` updater channel | In-app auto-update (`plugins.updater.pubkey` in `tauri.conf.json`) |
| **Apple codesign + notarization** | `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | `.app`, `.dmg` | macOS Gatekeeper / notarytool |
| **OpenPGP (optional)** | `RELEASE_GPG_PRIVATE_KEY`, `RELEASE_GPG_PASSPHRASE` | DMG, updater bundle, `latest.json`, `SHA256SUMS` | Humans verifying `.asc` on GitHub Releases |

`TAURI_SIGNING_PRIVATE_KEY` is **minisign**, not a GPG key and not an Apple certificate.

### Tauri updater (minisign)

- Generate once: `cargo tauri signer generate -w ~/.tauri/pyrfor.key`
- Commit **public** key to `apps/pyrfor-ide/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`)
- Store **private** key only in GitHub Actions: `TAURI_SIGNING_PRIVATE_KEY`
- CI ([`.github/workflows/pyrfor-release.yml`](../.github/workflows/pyrfor-release.yml)) runs `cargo tauri signer verify` on every `*.app.tar.gz.sig` after build

### Apple Developer ID + notarization

Required for **tagged** releases (`v*.*.*` push). `workflow_dispatch` can set `allow_unsigned=true` for dry runs without Apple secrets.

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | Base64-encoded `.p12` export |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email for notarytool |
| `APPLE_PASSWORD` | App-specific password (not account password) |
| `APPLE_TEAM_ID` | 10-character Team ID |

After `cargo tauri build`, CI submits the DMG with `xcrun notarytool submit --wait`, staples with `xcrun stapler staple`, and runs `spctl` / `codesign -dv` as insurance.

Local maintainer check:

```bash
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
spctl -a -vv -t install path/to/Pyrfor.dmg
```

### Optional GPG release signatures

If `RELEASE_GPG_PRIVATE_KEY` is **not** set, releases still publish; CI logs a notice. When set, CI emits detached `.asc` files for DMG, updater tarball, `latest.json`, and `SHA256SUMS`.

```bash
gpg --verify Pyrfor.dmg.asc Pyrfor.dmg
```

### Windows / Linux

- **Windows:** code signing cert + same Tauri updater minisign secrets when Windows jobs are enabled.
- **Linux:** ship AppImage/deb from CI; use GPG `.asc` when distributing outside GitHub.

See [Tauri — signing](https://v2.tauri.app/distribute/sign/) and [updater](https://v2.tauri.app/plugin/updater/).

## Pre-release checklist

```bash
pnpm test
pnpm release:check
pnpm swe-bench:smoke
```

## Public documentation

Docs deploy separately: [`.github/workflows/docs-deploy.yml`](../.github/workflows/docs-deploy.yml) → https://docs.pyrfor.dev. See [`docs-site/DEPLOY.md`](../docs-site/DEPLOY.md).
