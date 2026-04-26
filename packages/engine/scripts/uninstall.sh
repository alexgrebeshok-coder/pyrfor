#!/usr/bin/env bash
# ============================================================
# Pyrfor Runtime — Uninstaller
# Usage:  ./uninstall.sh [OPTIONS]
# ============================================================
set -euo pipefail

# ── colour helpers ──────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { printf "${CYAN}[pyrfor]${RESET} %s\n"            "$*"; }
success() { printf "${GREEN}[pyrfor]${RESET} ${BOLD}%s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}[pyrfor] WARN:${RESET} %s\n"    "$*" >&2; }
die()     { printf "${RED}[pyrfor] ERROR:${RESET} %s\n"      "$*" >&2; exit 1; }

# ── flag defaults ────────────────────────────────────────────
NON_INTERACTIVE=false
KEEP_CONFIG=false
PURGE=false

usage() {
  cat <<EOF
${BOLD}Pyrfor Runtime Uninstaller${RESET}

  ${BOLD}uninstall.sh${RESET} [OPTIONS]

Options:
  --non-interactive   Skip all prompts; keep ~/.pyrfor/ (safe default).
  --keep-config       Stop the service and remove completions, but keep
                      ~/.pyrfor/ (config + sessions) intact.
  --purge             Remove ~/.pyrfor/ including all sessions without
                      prompting (use with care — data is unrecoverable).
  --help, -h          Show this help and exit.

What this script does:
  1. Stops and unregisters the Pyrfor background service (if installed).
  2. Removes shell completions installed by install.sh.
  3. Optionally removes ~/.pyrfor/ (config + sessions).

Note: --keep-config and --purge are mutually exclusive.

EOF
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=true ;;
    --keep-config)     KEEP_CONFIG=true ;;
    --purge)           PURGE=true ;;
    --help|-h)         usage ;;
    *) die "Unknown argument: $arg. Run with --help for usage." ;;
  esac
done

if [ "$PURGE" = true ] && [ "$KEEP_CONFIG" = true ]; then
  die "--purge and --keep-config are mutually exclusive."
fi

# ── root guard ──────────────────────────────────────────────
if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. Proceed with caution."
fi

# ── helper: prompt_yn ────────────────────────────────────────
prompt_yn() {
  local __var="$1" question="$2"
  if [ "$NON_INTERACTIVE" = true ]; then
    eval "$__var=\"\$3\""
    return
  fi
  printf "%s " "$question"
  local reply
  IFS= read -r reply
  reply=$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')
  case "$reply" in
    y|yes) eval "$__var=y" ;;
    n|no)  eval "$__var=n" ;;
    *)     eval "$__var=\"\$3\"" ;;
  esac
}

# ── 1. Locate repo root (same logic as install.sh) ───────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT=""
dir="$SCRIPT_DIR"
while [ "$dir" != "/" ]; do
  if [ -f "$dir/pnpm-workspace.yaml" ] || \
     { [ -f "$dir/package.json" ] && [ -d "$dir/packages" ]; }; then
    REPO_ROOT="$dir"
    break
  fi
  dir="$(dirname "$dir")"
done

# ── 2. "What will be removed" preview ────────────────────────
PYRFOR_DIR="$HOME/.pyrfor"
BASH_COMP="$HOME/.local/share/bash-completion/completions/pyrfor-runtime"
ZSH_COMP="$HOME/.zsh/completions/_pyrfor_runtime"
FISH_COMP="$HOME/.config/fish/completions/pyrfor-runtime.fish"

printf '%b\n' "\n${BOLD}What will be removed:${RESET}"
printf "  * Pyrfor background service (LaunchAgent / systemd user unit)\n"
for _comp_path in "$BASH_COMP" "$ZSH_COMP" "$FISH_COMP"; do
  if [ -f "$_comp_path" ]; then
    printf "  * Shell completion: %s\n" "$_comp_path"
  fi
done
if [ "$PURGE" = true ]; then
  if [ -d "$PYRFOR_DIR" ]; then
    printf "  * %s  (--purge: config + all sessions)\n" "$PYRFOR_DIR"
  fi
elif [ "$KEEP_CONFIG" = false ] && [ -d "$PYRFOR_DIR" ]; then
  printf "  * %s  (config + sessions — you will be prompted)\n" "$PYRFOR_DIR"
fi
printf "\n"

# ── 3. Unregister background service ─────────────────────────
info "Stopping and unregistering Pyrfor service…"
if [ -n "$REPO_ROOT" ] && command -v npx >/dev/null 2>&1; then
  (cd "$REPO_ROOT" && \
    npx tsx packages/engine/src/runtime/cli.ts service uninstall 2>&1) \
    || warn "Service uninstall reported an error (may not have been installed — continuing)."
else
  warn "Could not locate repo root or npx; skipping service uninstall."
fi

# ── 4. Remove shell completions ───────────────────────────────
info "Removing shell completions…"
for _comp_path in "$BASH_COMP" "$ZSH_COMP" "$FISH_COMP"; do
  if [ -f "$_comp_path" ]; then
    rm -f "$_comp_path"
    success "Removed completion: $_comp_path"
  fi
done

# ── 5. Optionally delete ~/.pyrfor/ ──────────────────────────
if [ "$KEEP_CONFIG" = true ]; then
  info "Keeping $PYRFOR_DIR (--keep-config)."
elif [ "$PURGE" = true ]; then
  if [ -d "$PYRFOR_DIR" ]; then
    rm -rf "$PYRFOR_DIR"
    success "Purged $PYRFOR_DIR"
  else
    info "$PYRFOR_DIR does not exist — nothing to purge."
  fi
elif [ -d "$PYRFOR_DIR" ]; then
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
