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

# ── 2. Copy Node binary and all non-system dylibs ─────────────────────────────
echo "==> [build-sidecar] Copying Node binary and bundled dylibs …"
NODE_BIN="$(which node)"
NODE_REAL="$(realpath "$NODE_BIN")"
NODE_PREFIX="$(dirname "$(dirname "$NODE_REAL")")"
echo "    node → $NODE_REAL  (prefix: $NODE_PREFIX)"

mkdir -p "$RUNTIME_DIR"
rm -f "$RUNTIME_DIR/node" "$RUNTIME_DIR"/*.dylib
cp "$NODE_REAL" "$RUNTIME_DIR/node"
chmod u+rwx,go+rx "$RUNTIME_DIR/node"

TMP_DYLIB_DIR="$(mktemp -d)"
DYLIB_QUEUE="$TMP_DYLIB_DIR/queue"
DYLIB_SEEN="$TMP_DYLIB_DIR/seen"
: > "$DYLIB_QUEUE"
: > "$DYLIB_SEEN"

enqueue_dylib_scan() {
  local file="$1"
  if [ ! -e "$file" ]; then
    return
  fi
  if grep -Fxq "$file" "$DYLIB_SEEN"; then
    return
  fi
  printf '%s\n' "$file" >> "$DYLIB_SEEN"
  printf '%s\n' "$file" >> "$DYLIB_QUEUE"
}

copy_runtime_dylib() {
  local dep="$1"
  local base
  local dest
  base="$(basename "$dep")"
  dest="$RUNTIME_DIR/$base"
  if [ ! -f "$dest" ]; then
    cp "$dep" "$dest"
    chmod u+rw,go+r "$dest"
    install_name_tool -id "@loader_path/$base" "$dest" 2>/dev/null || true
    echo "    dylib → $dep"
  fi
  enqueue_dylib_scan "$dest"
}

rewrite_runtime_deps() {
  local file="$1"
  local dep
  while IFS= read -r dep; do
    case "$dep" in
      /usr/lib/*|/System/*|@executable_path/*)
        continue
        ;;
      @loader_path/*)
        local base="${dep##*/}"
        local candidate="$RUNTIME_DIR/$base"
        if [ ! -f "$candidate" ]; then
          local loader_candidate
          loader_candidate="$(ls /opt/homebrew/lib/"$base" /usr/local/lib/"$base" /opt/homebrew/opt/*/lib/"$base" /usr/local/opt/*/lib/"$base" 2>/dev/null | head -1 || true)"
          if [ -n "$loader_candidate" ]; then
            copy_runtime_dylib "$loader_candidate"
          else
            echo "    ⚠️  missing @loader_path dependency $dep in $file"
          fi
        else
          enqueue_dylib_scan "$candidate"
        fi
        ;;
      @rpath/*)
        local base="${dep##*/}"
        local candidate="$RUNTIME_DIR/$base"
        if [ ! -f "$candidate" ] && [ -f "$NODE_PREFIX/lib/$base" ]; then
          copy_runtime_dylib "$NODE_PREFIX/lib/$base"
        elif [ ! -f "$candidate" ] && [ -f "/opt/homebrew/lib/$base" ]; then
          copy_runtime_dylib "/opt/homebrew/lib/$base"
        elif [ ! -f "$candidate" ] && [ -f "/usr/local/lib/$base" ]; then
          copy_runtime_dylib "/usr/local/lib/$base"
        elif [ ! -f "$candidate" ]; then
          local opt_candidate
          opt_candidate="$(ls /opt/homebrew/opt/*/lib/"$base" /usr/local/opt/*/lib/"$base" 2>/dev/null | head -1 || true)"
          if [ -n "$opt_candidate" ]; then
            copy_runtime_dylib "$opt_candidate"
          fi
        fi
        if [ -f "$candidate" ]; then
          install_name_tool -change "$dep" "@loader_path/$base" "$file" 2>/dev/null || true
          enqueue_dylib_scan "$candidate"
        else
          echo "    ⚠️  unresolved @rpath dependency $dep in $file"
        fi
        ;;
      /*)
        if [ -f "$dep" ]; then
          local base="${dep##*/}"
          copy_runtime_dylib "$dep"
          install_name_tool -change "$dep" "@loader_path/$base" "$file" 2>/dev/null || true
        fi
        ;;
      *)
        echo "    ⚠️  unrecognized dependency $dep in $file"
        ;;
    esac
  done < <(otool -L "$file" | awk 'NR > 1 { print $1 }')
}

enqueue_dylib_scan "$RUNTIME_DIR/node"
while [ -s "$DYLIB_QUEUE" ]; do
  DYLIB_FILE="$(head -n 1 "$DYLIB_QUEUE")"
  tail -n +2 "$DYLIB_QUEUE" > "$DYLIB_QUEUE.next"
  mv "$DYLIB_QUEUE.next" "$DYLIB_QUEUE"
  rewrite_runtime_deps "$DYLIB_FILE"
done
rm -rf "$TMP_DYLIB_DIR"

echo "==> [build-sidecar] Auditing bundled dylibs for non-portable install names …"
NON_PORTABLE_DEPS="$(
  for binary in "$RUNTIME_DIR/node" "$RUNTIME_DIR"/*.dylib; do
    [ -e "$binary" ] || continue
    otool -L "$binary" | awk 'NR > 1 { print $1 }' | grep -E '^(/opt/homebrew|/usr/local|.*/Cellar/)' || true
  done
)"
if [ -n "$NON_PORTABLE_DEPS" ]; then
  echo "❌  [build-sidecar] Non-portable dylib references remain:"
  echo "$NON_PORTABLE_DEPS"
  exit 1
fi

echo "==> [build-sidecar] Re-signing rewritten Mach-O runtime files …"
for binary in "$RUNTIME_DIR"/*.dylib "$RUNTIME_DIR/node"; do
  [ -e "$binary" ] || continue
  codesign --force --sign - "$binary" >/dev/null
done
xattr -cr "$RUNTIME_DIR" 2>/dev/null || true

echo "==> [build-sidecar] Node runtime copied."

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
echo "==> [build-sidecar] Smoke-testing launcher (capturing stdout for up to 20s) …"

CAPTURE_FILE="$APP_DIR/.smoke-stdout"
rm -f "$CAPTURE_FILE"

PYRFOR_TELEGRAM_AUTOSTART=false PYRFOR_PORT=0 "$LAUNCHER" > "$CAPTURE_FILE" 2>&1 &
DAEMON_PID=$!

LISTENING_LINE=""
TIMEOUT=20
START_SECONDS=$SECONDS
FOUND=0

while [ $((SECONDS - START_SECONDS)) -lt "$TIMEOUT" ]; do
  if [ -f "$CAPTURE_FILE" ] && grep -q "^LISTENING_ON=" "$CAPTURE_FILE" 2>/dev/null; then
    LISTENING_LINE="$(grep "^LISTENING_ON=" "$CAPTURE_FILE" | head -1)"
    FOUND=1
    break
  fi
  sleep 0.5
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
