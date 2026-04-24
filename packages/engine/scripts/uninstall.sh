#!/usr/bin/env bash
# ============================================================
# Pyrfor Runtime — Uninstaller
# Usage:  ./uninstall.sh [--non-interactive] [--help]
# ============================================================
set -euo pipefail

# ── colour helpers ──────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { printf "${CYAN}[pyrfor]${RESET} %s\n"            "$*"; }
success() { printf "${GREEN}[pyrfor]${RESET} ${BOLD}%s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}[pyrfor] WARN:${RESET} %s\n"    "$*" >&2; }
die()     { printf "${RED}[pyrfor] ERROR:${RESET} %s\n"      "$*" >&2; exit 1; }

# ── flag parsing ─────────────────────────────────────────────
NON_INTERACTIVE=false

usage() {
  cat <<EOF
${BOLD}Pyrfor Runtime Uninstaller${RESET}

  ${BOLD}uninstall.sh${RESET} [OPTIONS]

Options:
  --non-interactive   Skip all prompts; keep ~/.pyrfor/ (safe default).
  --help, -h          Show this help and exit.

What this script does:
  1. Stops and unregisters the Pyrfor background service (if installed).
  2. Optionally removes ~/.pyrfor/ (config + sessions).

EOF
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=true ;;
    --help|-h)         usage ;;
    *) die "Unknown argument: $arg. Run with --help for usage." ;;
  esac
done

# ── helper: prompt_yn ────────────────────────────────────────
prompt_yn() {
  local __var="$1" question="$2" default="$3"
  if [ "$NON_INTERACTIVE" = true ]; then
    eval "$__var=\"\$default\""
    return
  fi
  printf "%s " "$question"
  local reply
  IFS= read -r reply
  reply=$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')
  case "$reply" in
    y|yes) eval "$__var=y" ;;
    n|no)  eval "$__var=n" ;;
    *)     eval "$__var=\"\$default\"" ;;
  esac
}

# ── 1. Locate repo root (same logic as install.sh) ───────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT=""
dir="$SCRIPT_DIR"
while [ "$dir" != "/" ]; do
  if [ -f "$dir/pnpm-workspace.yaml" ] || \
     ( [ -f "$dir/package.json" ] && [ -d "$dir/packages" ] ); then
    REPO_ROOT="$dir"
    break
  fi
  dir="$(dirname "$dir")"
done

# ── 2. Unregister background service ─────────────────────────
info "Stopping and unregistering Pyrfor service…"
if [ -n "$REPO_ROOT" ] && command -v npx >/dev/null 2>&1; then
  (cd "$REPO_ROOT" && \
    npx tsx packages/engine/src/runtime/cli.ts service uninstall 2>&1) \
    || warn "Service uninstall reported an error (may not have been installed — continuing)."
else
  warn "Could not locate repo root or npx; skipping service uninstall."
fi

# ── 3. Optionally delete ~/.pyrfor/ ──────────────────────────
PYRFOR_DIR="$HOME/.pyrfor"
if [ -d "$PYRFOR_DIR" ]; then
  prompt_yn DELETE_DATA \
    "Delete $PYRFOR_DIR (config + sessions)? [y/N]:" "n"
  if [ "$DELETE_DATA" = "y" ]; then
    rm -rf "$PYRFOR_DIR"
    success "Deleted $PYRFOR_DIR"
  else
    info "Keeping $PYRFOR_DIR — no data removed."
  fi
else
  info "$PYRFOR_DIR does not exist — nothing to remove."
fi

# ── Done ──────────────────────────────────────────────────────
printf "\n"
success "Pyrfor Runtime uninstalled."
printf "\n"
