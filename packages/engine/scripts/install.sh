#!/usr/bin/env bash
# ============================================================
# Pyrfor Runtime — One-button installer
# Supports: macOS (bash 3.2+), Linux
# Usage:  ./install.sh [--non-interactive] [--help]
# ============================================================
set -euo pipefail

# ── colour helpers ──────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { printf "${CYAN}[pyrfor]${RESET} %s\n"            "$*"; }
success() { printf "${GREEN}[pyrfor]${RESET} ${BOLD}%s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}[pyrfor] WARN:${RESET} %s\n"    "$*" >&2; }
die()     { printf "${RED}[pyrfor] ERROR:${RESET} %s\n"      "$*" >&2; exit 1; }

# ── flag parsing ────────────────────────────────────────────
NON_INTERACTIVE=false
WITH_COMPLETIONS=false

usage() {
  cat <<EOF
${BOLD}Pyrfor Runtime Installer${RESET}

  ${BOLD}install.sh${RESET} [OPTIONS]

Options:
  --non-interactive   Skip all prompts; use defaults (no bot token,
                      no OpenAI key, no background service install).
  --with-completions  Install shell completion scripts (non-interactive).
  --help, -h          Show this help and exit.

What this script does:
  1. Detects platform (macOS / Linux).
  2. Checks Node.js >= 20 and pnpm (offers to install pnpm if missing).
  3. Warns about optional deps: ffmpeg, whisper-cli.
  4. Runs \`pnpm install --filter @ceoclaw/engine...\` from the repo root.
  5. Creates ~/.pyrfor/ and generates runtime.json if absent.
  6. Optionally registers Pyrfor as a background service
     (macOS LaunchAgent / Linux systemd user unit).
  7. Optionally installs shell completion scripts.

EOF
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=true ;;
    --with-completions) WITH_COMPLETIONS=true ;;
    --help|-h)         usage ;;
    *) die "Unknown argument: $arg. Run with --help for usage." ;;
  esac
done

# ── helper: prompt with default ─────────────────────────────
# prompt VAR "Question [Default]:" default_value
prompt() {
  local __var="$1" question="$2" default="$3"
  if [ "$NON_INTERACTIVE" = true ]; then
    eval "$__var=\"\$default\""
    return
  fi
  printf "%s " "$question"
  local reply
  IFS= read -r reply
  if [ -z "$reply" ]; then
    eval "$__var=\"\$default\""
  else
    eval "$__var=\"\$reply\""
  fi
}

# prompt_yn VAR "Question [Y/n]:" default_yn   (y/n)
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
    npm install -g pnpm || die "Failed to install pnpm."
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
     ( [ -f "$dir/package.json" ] && [ -d "$dir/packages" ] ); then
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
(cd "$REPO_ROOT" && pnpm install --filter "@ceoclaw/engine...") \
  || die "pnpm install failed."
success "Dependencies installed."

# ── 7. Create ~/.pyrfor/ ──────────────────────────────────────
PYRFOR_DIR="$HOME/.pyrfor"
SESSIONS_DIR="$PYRFOR_DIR/sessions"
CONFIG_FILE="$PYRFOR_DIR/runtime.json"

info "Creating $PYRFOR_DIR …"
mkdir -p "$SESSIONS_DIR"
chmod 0700 "$PYRFOR_DIR"

# ── 8. Generate runtime.json if absent ───────────────────────
if [ -f "$CONFIG_FILE" ]; then
  info "Config already exists at $CONFIG_FILE — skipping generation."
else
  info "Generating $CONFIG_FILE …"

  BOT_TOKEN=""
  OPENAI_KEY=""
  if [ "$NON_INTERACTIVE" = false ]; then
    printf "\n${BOLD}Optional configuration${RESET} (press Enter to skip)\n\n"
    prompt BOT_TOKEN  "  Telegram bot token  (from @BotFather, optional):" ""
    prompt OPENAI_KEY "  OpenAI API key      (sk-..., optional):"          ""
    printf "\n"
  fi

  # Generate a random 32-byte hex bearer token
  if command -v openssl >/dev/null 2>&1; then
    BEARER_TOKEN="$(openssl rand -hex 32)"
  else
    # Fallback: read from /dev/urandom (available on Linux and macOS)
    BEARER_TOKEN="$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  fi

  # Determine telegram.enabled based on whether a token was provided
  if [ -n "$BOT_TOKEN" ]; then
    TG_ENABLED=true
  else
    TG_ENABLED=false
    BOT_TOKEN=""
  fi

  # Determine openai key field
  if [ -n "$OPENAI_KEY" ]; then
    OPENAI_BLOCK="\"openai\": { \"apiKey\": \"${OPENAI_KEY}\" },"
  else
    OPENAI_BLOCK=""
  fi

  # Write JSON (bash printf is safe here; tokens are user-supplied strings,
  # not evaluated by the shell after this point)
  cat > "$CONFIG_FILE" <<JSONEOF
{
  "telegram": {
    "enabled": ${TG_ENABLED},
    "botToken": "${BOT_TOKEN}",
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
    "bearerToken": "${BEARER_TOKEN}"
  },
  ${OPENAI_BLOCK:+${OPENAI_BLOCK}
  }"cron": {
    "jobs": []
  },
  "health": {
    "intervalMs": 60000
  }
}
JSONEOF

  chmod 0600 "$CONFIG_FILE"
  success "Config written to $CONFIG_FILE"
fi

# ── 9. Optionally install as background service ───────────────
prompt_yn INSTALL_SVC \
  "Install Pyrfor as a background service (auto-start on login)? [Y/n]:" "y"

if [ "$INSTALL_SVC" = "y" ]; then
  info "Registering background service…"
  (cd "$REPO_ROOT" && \
    npx tsx packages/engine/src/runtime/cli.ts service install \
      --workdir "$REPO_ROOT") \
    || warn "Service install step failed — you can retry manually with:
    cd $REPO_ROOT && npx tsx packages/engine/src/runtime/cli.ts service install --workdir $REPO_ROOT"
fi

# ── 10. Optionally install shell completions ─────────────────
COMPLETIONS_DIR="$(dirname "$0")/completions"

_install_completions() {
  local shell_type="$1"

  case "$shell_type" in
    bash)
      local dest_dir="$HOME/.local/share/bash-completion/completions"
      local dest="$dest_dir/pyrfor-runtime"
      local src="$COMPLETIONS_DIR/pyrfor-runtime.bash"
      mkdir -p "$dest_dir"
      if [ -f "$dest" ]; then
        cp -i "$dest" "${dest}.bak" 2>/dev/null && info "Backed up existing bash completion to ${dest}.bak"
      fi
      cp "$src" "$dest"
      success "Bash completion installed → $dest"
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
      mkdir -p "$dest_dir"
      local dest="$dest_dir/_pyrfor_runtime"
      if [ -f "$dest" ]; then
        cp -i "$dest" "${dest}.bak" 2>/dev/null && info "Backed up existing zsh completion to ${dest}.bak"
      fi
      cp "$src" "$dest"
      success "Zsh completion installed → $dest"
      if [ "$dest_dir" = "$HOME/.zsh/completions" ]; then
        printf "\n"
        printf "  ${BOLD}Add this to your ~/.zshrc:${RESET}\n"
        printf "    fpath+=(~/.zsh/completions)\n"
        printf "    autoload -Uz compinit && compinit\n"
        printf "\n"
      fi
      ;;
    fish)
      local dest_dir="$HOME/.config/fish/completions"
      local dest="$dest_dir/pyrfor-runtime.fish"
      local src="$COMPLETIONS_DIR/pyrfor-runtime.fish"
      mkdir -p "$dest_dir"
      if [ -f "$dest" ]; then
        cp -i "$dest" "${dest}.bak" 2>/dev/null && info "Backed up existing fish completion to ${dest}.bak"
      fi
      cp "$src" "$dest"
      success "Fish completion installed → $dest"
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

# ── 11. Done ──────────────────────────────────────────────────
printf "\n"
success "Pyrfor Runtime installed successfully! 🎉"
printf "\n"
printf "  ${BOLD}Config${RESET}          %s\n" "$CONFIG_FILE"
printf "  ${BOLD}Sessions${RESET}        %s\n" "$SESSIONS_DIR"
printf "  ${BOLD}Gateway URL${RESET}     http://localhost:18790\n"
printf "  ${BOLD}Health ping${RESET}     http://localhost:18790/ping\n"
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
