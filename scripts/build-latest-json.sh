#!/usr/bin/env bash
# scripts/build-latest-json.sh
# Generates latest.json for tauri-plugin-updater auto-update manifest.
# Must be run from repo root after `cargo tauri build --bundles updater`.
#
# Required env:
#   GITHUB_REF_NAME  — git tag, e.g. v1.2.3
#
# Output: latest.json in repo root (then uploaded as a Release asset).

set -euo pipefail

TAURI_DIR="apps/pyrfor-ide/src-tauri"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle/macos"
CONF="$TAURI_DIR/tauri.conf.json"

# Extract version from tauri.conf.json
VERSION=$(node -e "const c=require('./$CONF'); process.stdout.write(c.version)")

# Find the .app.tar.gz and its .sig
APP_TAR=$(ls "$BUNDLE_DIR"/*.app.tar.gz 2>/dev/null | head -1)
SIG_FILE="${APP_TAR}.sig"

if [ -z "$APP_TAR" ] || [ ! -f "$SIG_FILE" ]; then
  echo "ERROR: Could not find .app.tar.gz or .sig in $BUNDLE_DIR" >&2
  exit 1
fi

SIGNATURE=$(cat "$SIG_FILE")
TAG="${GITHUB_REF_NAME:-v$VERSION}"
APP_FILENAME=$(basename "$APP_TAR")
DOWNLOAD_URL="https://github.com/pyrfor-dev/pyrfor-ide/releases/download/${TAG}/${APP_FILENAME}"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > latest.json <<EOF
{
  "version": "$VERSION",
  "notes": "See the release notes at https://github.com/pyrfor-dev/pyrfor-ide/releases/tag/$TAG",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIGNATURE",
      "url": "$DOWNLOAD_URL"
    }
  }
}
EOF

echo "Generated latest.json for Pyrfor v$VERSION ($TAG)"
cat latest.json
