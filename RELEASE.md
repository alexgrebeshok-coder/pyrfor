# Pyrfor IDE — Release Runbook

This document describes how to cut a new Pyrfor IDE release. A release artifact must bundle the `packages/engine/src/runtime` sidecar built from the same commit; standalone daemon listeners are development/compatibility surfaces, not the production release contract.

---

## Prerequisites (one-time setup)

### 1. GitHub repository

Create `pyrfor-dev/pyrfor-ide` on GitHub and push this repo.

### 2. Updater signing key

The keypair has already been generated at `apps/pyrfor-ide/.tauri/updater.key` (private, gitignored)
and `apps/pyrfor-ide/.tauri/updater.key.pub` (public, committed in `tauri.conf.json`).

Add the **private key** as a GitHub Actions secret:

```bash
# Copy private key contents to clipboard
cat apps/pyrfor-ide/.tauri/updater.key | pbcopy
```

Go to **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Paste from clipboard |

### 3. Apple Developer ID (required for tagged releases)

Tagged releases fail if signing/notarization/updater secrets are missing. Unsigned local smoke builds are allowed only before tagging.

| Secret | How to obtain |
|---|---|
| `APPLE_SIGNING_IDENTITY` | Run `security find-identity -v -p codesigning` on a Mac with your cert imported; copy the _"Developer ID Application: …"_ string |
| `APPLE_CERTIFICATE_P12` | Export from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_TEAM_ID` | Your 10-character Team ID from developer.apple.com |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com |

---

## Cutting a release

```bash
# 1. Ensure main is clean and tests pass
git checkout main && git pull
pnpm qa:first-run
pnpm ide:build:sidecar
pnpm release:check

# 2. Bump version in tauri.conf.json
#    "version": "X.Y.Z"
vim apps/pyrfor-ide/src-tauri/tauri.conf.json

# 3. Commit version bump
git add apps/pyrfor-ide/src-tauri/tauri.conf.json
git commit -m "chore: bump Pyrfor IDE to vX.Y.Z

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

# 4. Tag and push
git tag vX.Y.Z
git push origin main --tags
```

CI (`.github/workflows/pyrfor-release.yml`) will:
1. Run engine + web tests plus `pnpm qa:first-run`.
2. Build the engine sidecar from the tagged commit and fail if the launcher cannot emit `LISTENING_ON=<port>`.
3. Verify the release contract with `pnpm release:check`.
4. Require Apple signing/notarization and Tauri updater secrets for tagged releases.
5. Run `cargo tauri build --bundles dmg,app,updater`.
6. Generate `latest.json`.
7. Create a GitHub Release with assets: `.dmg`, `.app.tar.gz`, `.app.tar.gz.sig`, `latest.json`.

---

## Verifying a release

```bash
# Check Gatekeeper passes (signed build only)
spctl --assess --type exec /Applications/Pyrfor.app

# Verify updater signature manually
minisign -Vm Pyrfor.app.tar.gz -P <pubkey>
```

---

## Rollback

If a release is broken:
1. Delete the GitHub Release (keep the tag for history or delete and retag).
2. Remove or update `latest.json` — existing installs will no longer see the bad version.
3. Cut a new patch release.
