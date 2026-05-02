#!/usr/bin/env bash
# build-sidecar.sh — Packages packages/engine into a self-contained Node sidecar
# for Tauri externalBin.
#
# Output layout inside apps/pyrfor-ide/src-tauri/binaries/:
#   _runtime/node                         ← copy of the Node 22 binary
#   _app/bin/pyrfor.cjs                   ← entry point
#   _app/dist/                            ← transpiled engine code
#   _app/package.json
#   _app/node_modules/                    ← production deps (npm install --omit=dev)
#   pyrfor-daemon-aarch64-apple-darwin    ← launcher shell script (committed)
#
# Usage:
#   bash apps/pyrfor-ide/scripts/build-sidecar.sh
#
# The launcher forwards --port="${PYRFOR_PORT:-0}" so the Rust sidecar manager
# can discover the actual port from stdout: LISTENING_ON=<port>.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENGINE_DIR="$REPO_ROOT/packages/engine"
BINARIES_DIR="$REPO_ROOT/apps/pyrfor-ide/src-tauri/binaries"
APP_DIR="$BINARIES_DIR/_app"
RUNTIME_DIR="$BINARIES_DIR/_runtime"
LAUNCHER="$BINARIES_DIR/pyrfor-daemon-aarch64-apple-darwin"

echo "==> [build-sidecar] Repo root: $REPO_ROOT"

# ── 1. Build packages/engine ──────────────────────────────────────────────────
echo "==> [build-sidecar] Building packages/engine …"
(cd "$ENGINE_DIR" && npm run build)
echo "==> [build-sidecar] Engine build complete."

# ── 2. Copy Node binary (and required dylibs) ─────────────────────────────────
echo "==> [build-sidecar] Copying Node binary …"
NODE_BIN="$(which node)"
NODE_REAL="$(realpath "$NODE_BIN")"
NODE_PREFIX="$(dirname "$(dirname "$NODE_REAL")")"
echo "    node → $NODE_REAL  (prefix: $NODE_PREFIX)"

mkdir -p "$RUNTIME_DIR"
# Remove existing binary first (it may be read-only from a previous Homebrew copy)
rm -f "$RUNTIME_DIR/node"
cp "$NODE_REAL" "$RUNTIME_DIR/node"
chmod u+rwx,go+rx "$RUNTIME_DIR/node"

# The Homebrew node binary resolves libnode via @loader_path (same dir as the
# binary), so copy it alongside node.
LIBNODE="$(ls "$NODE_PREFIX/lib/libnode."*.dylib 2>/dev/null | head -1)"
if [ -n "$LIBNODE" ]; then
  # libnode may also be read-only from Homebrew — remove first
  LIBNODE_BASENAME="$(basename "$LIBNODE")"
  rm -f "$RUNTIME_DIR/$LIBNODE_BASENAME"
  cp "$LIBNODE" "$RUNTIME_DIR/"
  chmod u+rw,go+r "$RUNTIME_DIR/$LIBNODE_BASENAME"
  echo "    libnode → $LIBNODE"
else
  echo "    ⚠️  libnode not found under $NODE_PREFIX/lib — launcher may fail to start"
fi
xattr -cr "$RUNTIME_DIR" 2>/dev/null || true

echo "==> [build-sidecar] Node binary copied."

# ── 3. Copy engine artefacts into _app/ ──────────────────────────────────────
echo "==> [build-sidecar] Copying engine artefacts …"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

cp -r "$ENGINE_DIR/bin"         "$APP_DIR/bin"
cp -r "$ENGINE_DIR/dist"        "$APP_DIR/dist"
cp    "$ENGINE_DIR/package.json" "$APP_DIR/package.json"

echo "==> [build-sidecar] Engine artefacts copied."

# ── 4. Install production dependencies ───────────────────────────────────────
echo "==> [build-sidecar] Installing production dependencies in _app/ …"

# Use the same node/npm that built the engine.
# --omit=dev  — skip devDependencies
# --no-audit  — speed; this is a packaging step, not a security audit
# --no-fund   — suppress funding messages
# --prefer-offline — use cache if available
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --prefer-offline)
echo "==> [build-sidecar] Production deps installed."

# Next.js' `server-only` package intentionally throws when imported outside the
# Next compiler/runtime. The engine contains legacy server modules with marker
# imports, and the sidecar is a pure Node runtime, so provide a no-op marker.
mkdir -p "$APP_DIR/node_modules/server-only"
printf '{}\n' > "$APP_DIR/node_modules/server-only/package.json"
printf '// no-op marker for Pyrfor sidecar runtime\n' > "$APP_DIR/node_modules/server-only/index.js"

# ── 4b. Smoke-test native node-pty ───────────────────────────────────────────
echo "==> [build-sidecar] Running node-pty smoke test …"
# Ensure spawn-helper is executable (npm pack/unpack can drop the +x bit)
find "$APP_DIR/node_modules/node-pty/prebuilds" -name "spawn-helper" -exec chmod +x {} \; 2>/dev/null || true
if (cd "$APP_DIR" && node "$REPO_ROOT/apps/pyrfor-ide/scripts/smoke-pty.mjs"); then
  echo "✅  [build-sidecar] node-pty smoke test PASSED"
else
  echo "❌  [build-sidecar] node-pty smoke test FAILED"
  exit 1
fi

# ── 5. Ensure launcher is executable ─────────────────────────────────────────
# The launcher (pyrfor-daemon-aarch64-apple-darwin) is committed to git.
# Just ensure it is executable after checkout / on CI.
chmod +x "$LAUNCHER"
echo "==> [build-sidecar] Launcher is executable: $LAUNCHER"

# ── 6. Smoke-test: start daemon, capture stdout, wait for LISTENING_ON ───────
echo "==> [build-sidecar] Smoke-testing launcher (capturing stdout for up to 10s) …"

CAPTURE_FILE="$APP_DIR/.smoke-stdout"
rm -f "$CAPTURE_FILE"

PYRFOR_TELEGRAM_AUTOSTART=false PYRFOR_PORT=0 "$LAUNCHER" > "$CAPTURE_FILE" 2>&1 &
DAEMON_PID=$!

LISTENING_LINE=""
TIMEOUT=10
ELAPSED=0
FOUND=0

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  if [ -f "$CAPTURE_FILE" ] && grep -q "^LISTENING_ON=" "$CAPTURE_FILE" 2>/dev/null; then
    LISTENING_LINE="$(grep "^LISTENING_ON=" "$CAPTURE_FILE" | head -1)"
    FOUND=1
    break
  fi
  sleep 0.5
  ELAPSED=$(( ELAPSED + 1 ))
done

kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true

if [ "$FOUND" -eq 1 ]; then
  echo "✅  [build-sidecar] Smoke-test PASSED: got '$LISTENING_LINE'"
else
  echo "❌  [build-sidecar] LISTENING_ON not seen within ${TIMEOUT}s."
  echo "    Captured output:"
  cat "$CAPTURE_FILE" 2>/dev/null | head -20 || true
  rm -f "$CAPTURE_FILE"
  exit 1
fi

rm -f "$CAPTURE_FILE"
echo "==> [build-sidecar] Smoke-test done (daemon PID $DAEMON_PID killed)."
echo ""
echo "✅  Sidecar built successfully."
echo "    Launcher:    $LAUNCHER"
echo "    Node binary: $RUNTIME_DIR/node"
echo "    App:         $APP_DIR"
# Phase A3 — sidecar packaging complete.
