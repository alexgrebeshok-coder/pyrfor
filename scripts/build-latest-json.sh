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

# Find the updater archive and its signature.
APP_TAR=$(find "$BUNDLE_DIR" -maxdepth 1 -type f \( -name "*.app.tar.gz" -o -name "*.tar.gz" \) | head -1)
SIG_FILE="${APP_TAR}.sig"

if [ -z "$APP_TAR" ] || [ ! -f "$SIG_FILE" ]; then
  echo "ERROR: Could not find updater .tar.gz or .sig in $BUNDLE_DIR" >&2
  echo "Bundle files found:" >&2
  find "$TAURI_DIR/target/release/bundle" -maxdepth 3 -type f | sort >&2 || true
  exit 1
fi

SIGNATURE=$(cat "$SIG_FILE")
TAG="${GITHUB_REF_NAME:-v$VERSION}"
APP_FILENAME=$(basename "$APP_TAR")
REPOSITORY="${GITHUB_REPOSITORY:-pyrfor-org/pyrfor}"
DOWNLOAD_URL="https://github.com/${REPOSITORY}/releases/download/${TAG}/${APP_FILENAME}"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > latest.json <<EOF
{
  "version": "$VERSION",
  "notes": "See the release notes at https://github.com/${REPOSITORY}/releases/tag/$TAG",
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
