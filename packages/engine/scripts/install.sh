#!/usr/bin/env bash
# ============================================================
# Pyrfor Runtime — One-button installer
# Supports: macOS (bash 3.2+), Linux
# Usage:  ./install.sh [OPTIONS]
# ============================================================
set -euo pipefail

# ── colour helpers ──────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { printf "${CYAN}[pyrfor]${RESET} %s\n"            "$*"; }
success() { printf "${GREEN}[pyrfor]${RESET} ${BOLD}%s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}[pyrfor] WARN:${RESET} %s\n"    "$*" >&2; }
die()     { printf "${RED}[pyrfor] ERROR:${RESET} %s\n"      "$*" >&2; exit 1; }

# ── flag defaults ───────────────────────────────────────────
NON_INTERACTIVE=false
WITH_COMPLETIONS=false
NO_BUILD=false
WITH_PLAYWRIGHT=false
DRY_RUN=false
UPGRADE=false
PREFIX_DIR=""
TOKEN_BOT=""
TOKEN_OPENAI=""

usage() {
  cat <<EOF
${BOLD}Pyrfor Runtime Installer${RESET}

  ${BOLD}install.sh${RESET} [OPTIONS]

Options:
  --non-interactive         Skip all prompts; use defaults (no bot token,
                            no OpenAI key, no background service install).
  --with-completions        Install shell completion scripts (non-interactive).
  --no-build                Skip the TypeScript build step.
  --with-playwright         Also run \`pnpm exec playwright install chromium\`
                            after the engine install (browser tool ready).
  --token-bot=<value>       Telegram bot token (non-interactive CI flag).
  --token-openai=<value>    OpenAI API key (non-interactive CI flag).
  --dry-run                 Print all actions but execute nothing.
  --upgrade                 Keep existing ~/.pyrfor/runtime.json; skip token
                            regeneration and config overwrite.
  --prefix=<dir>            Override install location (default: ~/.pyrfor).
  --help, -h                Show this help and exit.

What this script does:
  1.  Detects platform (macOS / Linux).
  2.  Checks Node.js >= 20 and pnpm (offers to install pnpm if missing).
  3.  Warns about optional deps: ffmpeg, whisper-cli.
  4.  Runs \`pnpm install --filter @ceoclaw/engine...\` from the repo root.
  5.  Builds @ceoclaw/engine (unless --no-build); validates dist/runtime/cli.js.
  6.  Optionally installs Playwright chromium (--with-playwright).
  7.  Creates the install dir (default: ~/.pyrfor) and generates runtime.json.
  8.  Optionally registers Pyrfor as a background service
      (macOS LaunchAgent / Linux systemd user unit).
  9.  Optionally installs shell completion scripts.
  10. Runs a post-install smoke test against http://localhost:18790/ping.

EOF
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --non-interactive)    NON_INTERACTIVE=true ;;
    --with-completions)   WITH_COMPLETIONS=true ;;
    --no-build)           NO_BUILD=true ;;
    --with-playwright)    WITH_PLAYWRIGHT=true ;;
    --dry-run)            DRY_RUN=true ;;
    --upgrade)            UPGRADE=true ;;
    --prefix=*)           PREFIX_DIR="${arg#--prefix=}" ;;
    --token-bot=*)        TOKEN_BOT="${arg#--token-bot=}" ;;
    --token-openai=*)     TOKEN_OPENAI="${arg#--token-openai=}" ;;
    --help|-h)            usage ;;
    *) die "Unknown argument: $arg. Run with --help for usage." ;;
  esac
done

# ── dry-run wrapper ─────────────────────────────────────────
# run_cmd CMD [ARGS...] — execute or just print, honouring DRY_RUN.
run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    printf "${YELLOW}[dry-run]${RESET} %s\n" "$*"
  else
    "$@"
  fi
}

# ── root guard ──────────────────────────────────────────────
if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. Proceed with caution."
fi

# ── helper: prompt with default ─────────────────────────────
# prompt VAR "Question [Default]:" default_value
prompt() {
  local __var="$1" question="$2"
  if [ "$NON_INTERACTIVE" = true ]; then
    eval "$__var=\"\$3\""
    return
  fi
  printf "%s " "$question"
  local reply
  IFS= read -r reply
  if [ -z "$reply" ]; then
    eval "$__var=\"\$3\""
  else
    eval "$__var=\"\$reply\""
  fi
}

# prompt_yn VAR "Question [Y/n]:" default_yn   (y/n)
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

# ── 1. Platform check ────────────────────────────────────────
info "Detecting platform…"
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM=macos ;;
  Linux)  PLATFORM=linux ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    die "Windows is not supported. Please use WSL2 (Ubuntu) or a Linux VM." ;;
  *)
    die "Unsupported platform: $OS" ;;
esac
info "Platform: $PLATFORM"

# ── 2. Node.js >= 20 ─────────────────────────────────────────
info "Checking Node.js…"
if ! command -v node >/dev/null 2>&1; then
  die "Node.js not found. Install Node.js 20+ from https://nodejs.org/"
fi
NODE_VERSION_RAW="$(node -v)"                  # e.g. v20.11.0
NODE_MAJOR="${NODE_VERSION_RAW#v}"             # strip leading 'v'
NODE_MAJOR="${NODE_MAJOR%%.*}"                 # keep major only
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  die "Node.js >= 20 required (found $NODE_VERSION_RAW). Install from https://nodejs.org/"
fi
info "Node.js $NODE_VERSION_RAW — OK"

# ── 3. pnpm ──────────────────────────────────────────────────
info "Checking pnpm…"
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found."
  prompt_yn INSTALL_PNPM "Install pnpm globally via npm? [Y/n]:" "y"
  if [ "$INSTALL_PNPM" = "y" ]; then
    info "Running: npm install -g pnpm"
    run_cmd npm install -g pnpm || die "Failed to install pnpm."
  else
    die "pnpm is required. Install it manually: https://pnpm.io/installation"
  fi
fi
info "pnpm $(pnpm --version) — OK"

# ── 4. Optional: ffmpeg + whisper-cli ────────────────────────
info "Checking optional dependencies…"
if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "ffmpeg not found — voice transcription will be unavailable."
  if [ "$PLATFORM" = "macos" ]; then
    warn "  Install with: brew install ffmpeg"
  else
    warn "  Install with: sudo apt install ffmpeg   (or your distro's package manager)"
  fi
fi
if ! command -v whisper-cli >/dev/null 2>&1 && ! command -v whisper >/dev/null 2>&1; then
  warn "whisper-cli not found — local Whisper transcription will be unavailable."
  warn "  See: https://github.com/ggml-org/whisper.cpp"
fi

# ── 5. Locate repo root ───────────────────────────────────────
# Walk up from the directory containing this script until we find package.json
# with a known monorepo marker (pnpm-workspace.yaml or packages/ dir).
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
if [ -z "$REPO_ROOT" ]; then
  die "Could not locate repository root from $SCRIPT_DIR. \
Please run this script from inside the cloned repo."
fi
info "Repo root: $REPO_ROOT"

# ── 6. pnpm install ───────────────────────────────────────────
info "Installing @ceoclaw/engine and its dependencies…"
if [ "$DRY_RUN" = true ]; then
  printf "${YELLOW}[dry-run]${RESET} (cd \"%s\" && pnpm install --filter \"@ceoclaw/engine...\")\n" "$REPO_ROOT"
else
  (cd "$REPO_ROOT" && pnpm install --filter "@ceoclaw/engine...") \
    || die "pnpm install failed."
fi
success "Dependencies installed."

# ── 6b. Build @ceoclaw/engine ────────────────────────────────
if [ "$NO_BUILD" = false ]; then
  info "Building @ceoclaw/engine…"
  if [ "$DRY_RUN" = true ]; then
    printf "${YELLOW}[dry-run]${RESET} (cd \"%s\" && pnpm --filter @ceoclaw/engine build)\n" "$REPO_ROOT"
    printf '%b\n' "${YELLOW}[dry-run]${RESET} validate: dist/runtime/cli.js exists"
    printf '%b\n' "${YELLOW}[dry-run]${RESET} validate: node dist/runtime/cli.js --help exits 0"
  else
    (cd "$REPO_ROOT" && pnpm --filter "@ceoclaw/engine" build) \
      || die "Build failed. Fix the TypeScript errors above, or pass --no-build to skip."
    CLI_DIST="$REPO_ROOT/packages/engine/dist/runtime/cli.js"
    if [ ! -f "$CLI_DIST" ]; then
      die "Build completed but dist/runtime/cli.js was not produced. Check tsconfig/build config."
    fi
    success "Build complete — dist/runtime/cli.js present."
    if node "$CLI_DIST" --help >/dev/null 2>&1; then
      success "Runtime validation passed (node dist/runtime/cli.js --help -> exit 0)."
    else
      warn "Runtime validation: \`node dist/runtime/cli.js --help\` exited non-zero. Continuing."
    fi
  fi
fi

# ── 6c. Optional Playwright chromium ─────────────────────────
if [ "$WITH_PLAYWRIGHT" = true ]; then
  info "Installing Playwright chromium browser…"
  if [ "$DRY_RUN" = true ]; then
    printf "${YELLOW}[dry-run]${RESET} (cd \"%s\" && pnpm exec playwright install chromium)\n" "$REPO_ROOT"
  else
    (cd "$REPO_ROOT" && pnpm exec playwright install chromium) \
      || warn "Playwright chromium install failed — browser tools may not work."
  fi
fi

# ── 7. Create install directory ───────────────────────────────
PYRFOR_DIR="${PREFIX_DIR:-$HOME/.pyrfor}"
SESSIONS_DIR="$PYRFOR_DIR/sessions"
CONFIG_FILE="$PYRFOR_DIR/runtime.json"

info "Creating $PYRFOR_DIR …"
if [ "$DRY_RUN" = true ]; then
  printf "${YELLOW}[dry-run]${RESET} mkdir -p \"%s\"\n" "$SESSIONS_DIR"
  printf "${YELLOW}[dry-run]${RESET} chmod 0700 \"%s\"\n" "$PYRFOR_DIR"
else
  mkdir -p "$SESSIONS_DIR"
  chmod 0700 "$PYRFOR_DIR"
fi

# ── 8. Generate runtime.json ──────────────────────────────────
# Inner function; writes config file from two arguments: bot_token openai_key.
_write_config() {
  local bot_token="$1" openai_key="$2"
  local bearer_token tg_enabled openai_block

  if command -v openssl >/dev/null 2>&1; then
    bearer_token="$(openssl rand -hex 32)"
  else
    # Fallback: read from /dev/urandom (available on Linux and macOS)
    bearer_token="$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  fi

  if [ -n "$bot_token" ]; then
    tg_enabled=true
  else
    tg_enabled=false
    bot_token=""
  fi

  if [ -n "$openai_key" ]; then
    openai_block="\"openai\": { \"apiKey\": \"${openai_key}\" },"
  else
    openai_block=""
  fi

  # Write JSON (tokens are user-supplied strings, not evaluated by shell)
  cat > "$CONFIG_FILE" <<JSONEOF
{
  "telegram": {
    "enabled": ${tg_enabled},
    "botToken": "${bot_token}",
    "allowedChatIds": []
  },
  "voice": {
    "enabled": false,
    "provider": "local",
    "language": "auto"
  },
  "gateway": {
    "enabled": true,
    "port": 18790,
    "bearerToken": "${bearer_token}"
  },
  ${openai_block:+${openai_block}
  }"cron": {
    "jobs": []
  },
  "health": {
    "intervalMs": 60000
  }
}
JSONEOF
  chmod 0600 "$CONFIG_FILE"
}

if [ "$DRY_RUN" = true ]; then
  if [ -f "$CONFIG_FILE" ] && [ "$UPGRADE" = true ]; then
    printf "${YELLOW}[dry-run]${RESET} --upgrade: existing config kept as-is -> %s\n" "$CONFIG_FILE"
  elif [ -f "$CONFIG_FILE" ]; then
    printf "${YELLOW}[dry-run]${RESET} config already exists -> skip generation -> %s\n" "$CONFIG_FILE"
  else
    printf "${YELLOW}[dry-run]${RESET} write runtime.json -> %s\n" "$CONFIG_FILE"
  fi
elif [ -f "$CONFIG_FILE" ] && [ "$UPGRADE" = true ]; then
  info "Config exists at $CONFIG_FILE — --upgrade: keeping existing config, skipping regeneration."
elif [ -f "$CONFIG_FILE" ]; then
  info "Config already exists at $CONFIG_FILE — skipping generation."
else
  info "Generating $CONFIG_FILE …"

  BOT_TOKEN_EFF="${TOKEN_BOT}"
  OPENAI_KEY_EFF="${TOKEN_OPENAI}"

  if [ "$NON_INTERACTIVE" = false ]; then
    _needs_prompt=false
    [ -z "$BOT_TOKEN_EFF" ]  && _needs_prompt=true
    [ -z "$OPENAI_KEY_EFF" ] && _needs_prompt=true
    if [ "$_needs_prompt" = true ]; then
      printf '%b\n\n' "\n${BOLD}Optional configuration${RESET} (press Enter to skip)"
      if [ -z "$BOT_TOKEN_EFF" ]; then
        prompt BOT_TOKEN_EFF  "  Telegram bot token  (from @BotFather, optional):" ""
      fi
      if [ -z "$OPENAI_KEY_EFF" ]; then
        prompt OPENAI_KEY_EFF "  OpenAI API key      (sk-..., optional):"          ""
      fi
      printf "\n"
    fi
  fi

  _write_config "$BOT_TOKEN_EFF" "$OPENAI_KEY_EFF"
  success "Config written to $CONFIG_FILE"
fi

# ── 9. Optionally install as background service ───────────────
NO_SERVICE=false
prompt_yn INSTALL_SVC \
  "Install Pyrfor as a background service (auto-start on login)? [Y/n]:" "y"

if [ "$INSTALL_SVC" = "y" ]; then
  info "Registering background service…"
  if [ "$DRY_RUN" = true ]; then
    printf "${YELLOW}[dry-run]${RESET} (cd \"%s\" && npx tsx packages/engine/src/runtime/cli.ts service install --workdir \"%s\")\n" \
      "$REPO_ROOT" "$REPO_ROOT"
  else
    (cd "$REPO_ROOT" && \
      npx tsx packages/engine/src/runtime/cli.ts service install \
        --workdir "$REPO_ROOT") \
      || warn "Service install step failed — you can retry manually with:
    cd $REPO_ROOT && npx tsx packages/engine/src/runtime/cli.ts service install --workdir $REPO_ROOT"
  fi
else
  NO_SERVICE=true
fi

# ── 10. Optionally install shell completions ─────────────────
COMPLETIONS_DIR="$SCRIPT_DIR/completions"

_install_completions() {
  local shell_type="$1"

  case "$shell_type" in
    bash)
      local dest_dir="$HOME/.local/share/bash-completion/completions"
      local dest="$dest_dir/pyrfor-runtime"
      local src="$COMPLETIONS_DIR/pyrfor-runtime.bash"
      if [ "$DRY_RUN" = true ]; then
        printf "${YELLOW}[dry-run]${RESET} install bash completion -> %s\n" "$dest"
        return
      fi
      mkdir -p "$dest_dir"
      if [ -f "$dest" ]; then
        cp -i "$dest" "${dest}.bak" 2>/dev/null && info "Backed up existing bash completion to ${dest}.bak"
      fi
      cp "$src" "$dest"
      success "Bash completion installed -> $dest"
      ;;
    zsh)
      local src="$COMPLETIONS_DIR/pyrfor-runtime.zsh"
      # Try first writable dir in $fpath, fall back to ~/.zsh/completions
      local dest_dir=""
      if [ -n "${fpath+x}" ]; then
        for fp in $fpath; do
          if [ -w "$fp" ]; then
            dest_dir="$fp"
            break
          fi
        done
      fi
      if [ -z "$dest_dir" ]; then
        dest_dir="$HOME/.zsh/completions"
      fi
      local dest="$dest_dir/_pyrfor_runtime"
      if [ "$DRY_RUN" = true ]; then
        printf "${YELLOW}[dry-run]${RESET} install zsh completion -> %s\n" "$dest"
        return
      fi
      mkdir -p "$dest_dir"
      if [ -f "$dest" ]; then
        cp -i "$dest" "${dest}.bak" 2>/dev/null && info "Backed up existing zsh completion to ${dest}.bak"
      fi
      cp "$src" "$dest"
      success "Zsh completion installed -> $dest"
      if [ "$dest_dir" = "$HOME/.zsh/completions" ]; then
        printf "\n"
        printf '%b\n' "  ${BOLD}Add this to your ~/.zshrc:${RESET}"
        printf "    fpath+=(~/.zsh/completions)\n"
        printf "    autoload -Uz compinit && compinit\n"
        printf "\n"
      fi
      ;;
    fish)
      local dest_dir="$HOME/.config/fish/completions"
      local dest="$dest_dir/pyrfor-runtime.fish"
      local src="$COMPLETIONS_DIR/pyrfor-runtime.fish"
      if [ "$DRY_RUN" = true ]; then
        printf "${YELLOW}[dry-run]${RESET} install fish completion -> %s\n" "$dest"
        return
      fi
      mkdir -p "$dest_dir"
      if [ -f "$dest" ]; then
        cp -i "$dest" "${dest}.bak" 2>/dev/null && info "Backed up existing fish completion to ${dest}.bak"
      fi
      cp "$src" "$dest"
      success "Fish completion installed -> $dest"
      ;;
  esac
}

if [ "$WITH_COMPLETIONS" = true ]; then
  # Non-interactive: install for all detected shells
  info "Installing shell completions…"
  _install_completions bash
  _install_completions zsh
  _install_completions fish
elif [ "$NON_INTERACTIVE" = false ]; then
  # Interactive: detect current shell and offer
  detected_shell=""
  case "${SHELL:-}" in
    */bash) detected_shell="bash" ;;
    */zsh)  detected_shell="zsh"  ;;
    */fish) detected_shell="fish" ;;
  esac

  prompt_yn INSTALL_COMP \
    "Install shell completion scripts${detected_shell:+ (detected shell: $detected_shell)}? [y/N]:" "n"
  if [ "$INSTALL_COMP" = "y" ]; then
    if [ -n "$detected_shell" ]; then
      _install_completions "$detected_shell"
    else
      _install_completions bash
      _install_completions zsh
      _install_completions fish
    fi
  fi
fi

# ── 11. Post-install smoke test ───────────────────────────────
if [ "$NO_SERVICE" = false ]; then
  info "Running post-install smoke test (5 s timeout)…"
  if [ "$DRY_RUN" = true ]; then
    printf '%b\n' "${YELLOW}[dry-run]${RESET} curl -sf --max-time 5 http://localhost:18790/ping"
  else
    sleep 2
    if curl -sf --max-time 5 "http://localhost:18790/ping" >/dev/null 2>&1; then
      success "Smoke test passed — gateway is responding at http://localhost:18790/ping"
    else
      warn "Smoke test: gateway did not respond at http://localhost:18790/ping (may still be starting up)."
    fi
  fi
fi

# ── 12. Done ──────────────────────────────────────────────────
printf "\n"
success "Pyrfor Runtime installed successfully!"
printf "\n"
printf "  ${BOLD}Config${RESET}          %s\n" "$CONFIG_FILE"
printf "  ${BOLD}Sessions${RESET}        %s\n" "$SESSIONS_DIR"
printf '%b\n' "  ${BOLD}Gateway URL${RESET}     http://localhost:18790"
printf '%b\n' "  ${BOLD}Health ping${RESET}     http://localhost:18790/ping"
printf "\n"
printf "  ${BOLD}Start manually${RESET}  cd %s && \\\n" "$REPO_ROOT"
printf "                   npx tsx packages/engine/src/runtime/cli.ts\n"
printf "\n"
printf "  ${BOLD}Service status${RESET}  cd %s && \\\n" "$REPO_ROOT"
printf "                   npx tsx packages/engine/src/runtime/cli.ts service status\n"
printf "\n"
printf "  Edit %s to configure the bot token,\n" "$CONFIG_FILE"
printf "  allowed chat IDs, cron jobs, and more.\n"
printf "\n"
