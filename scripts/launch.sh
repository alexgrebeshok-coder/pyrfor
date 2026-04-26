#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$HOME/pyrfor-dev/logs"
LAUNCH_LOG="$LOG_DIR/launch.log"
DAEMON_STDOUT_LOG="$LOG_DIR/daemon.stdout.log"
DAEMON_STDERR_LOG="$LOG_DIR/daemon.stderr.log"
DAEMON_PID_FILE="$LOG_DIR/pyrfor-daemon.pid"
POSTGRES_STAMP="$LOG_DIR/postgresql@15.started-by-launcher"
PLIST_PATH="$HOME/Library/LaunchAgents/com.pyrfor.launch.plist"
LAUNCH_AGENT_LABEL="com.pyrfor.launch"
LAUNCH_APP_PATH="/Applications/Pyrfor Launch.app"
PYRFOR_APP_PATH="/Applications/Pyrfor.app"
APP_ICON_PATH="/Applications/Pyrfor.app/Contents/Resources/icon.icns"
REPO_ICON_PATH="$REPO_DIR/apps/pyrfor-ide/src-tauri/icons/icon.icns"
DAEMON_PORT="18790"
LAUNCHD_MODE="${1:-}"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

mkdir -p "$LOG_DIR" "$(dirname "$PLIST_PATH")"
touch "$LAUNCH_LOG" "$DAEMON_STDOUT_LOG" "$DAEMON_STDERR_LOG"

log() {
  local timestamp
  timestamp="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$timestamp" "$*" | tee -a "$LAUNCH_LOG"
}

fail() {
  log "ERROR: $*"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

listener_pid() {
  lsof -nP -iTCP:"$DAEMON_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1
}

engine_healthy() {
  curl -sf "http://127.0.0.1:${DAEMON_PORT}/health" >/dev/null 2>&1
}

ide_running() {
  osascript -e 'application id "dev.pyrfor.ide" is running' 2>/dev/null | grep -q '^true$'
}

write_launch_agent() {
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>sleep 30; exec '${REPO_DIR}/scripts/launch.sh' --launchd</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>LimitLoadToSessionType</key>
    <array>
      <string>Aqua</string>
    </array>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/launchagent.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/launchagent.stderr.log</string>
  </dict>
</plist>
PLIST
  plutil -lint "$PLIST_PATH" >/dev/null
}

load_launch_agent() {
  local gui_domain="gui/$(id -u)"
  write_launch_agent
  if launchctl print "${gui_domain}/${LAUNCH_AGENT_LABEL}" >/dev/null 2>&1; then
    log "LaunchAgent already loaded: ${LAUNCH_AGENT_LABEL}"
  else
    launchctl bootstrap "$gui_domain" "$PLIST_PATH"
    launchctl enable "${gui_domain}/${LAUNCH_AGENT_LABEL}" >/dev/null 2>&1 || true
    log "LaunchAgent loaded: ${LAUNCH_AGENT_LABEL}"
  fi
}

create_launch_app() {
  if ! command_exists osacompile; then
    log "osacompile not available; skipping Pyrfor Launch.app creation"
    return
  fi

  if [[ -d "$LAUNCH_APP_PATH" ]]; then
    log "Launch app already present: $LAUNCH_APP_PATH"
  else
    rm -rf "$LAUNCH_APP_PATH"
    osacompile -o "$LAUNCH_APP_PATH" <<APPLESCRIPT
on run
  do shell script quoted form of "${REPO_DIR}/scripts/launch.sh" & " >/dev/null 2>&1 &"
end run
APPLESCRIPT
    log "Created launch app: $LAUNCH_APP_PATH"
  fi

  local icon_path=""
  if [[ -f "$APP_ICON_PATH" ]]; then
    icon_path="$APP_ICON_PATH"
  elif [[ -f "$REPO_ICON_PATH" ]]; then
    icon_path="$REPO_ICON_PATH"
  fi

  if [[ -n "$icon_path" ]]; then
    cp "$icon_path" "$LAUNCH_APP_PATH/Contents/Resources/applet.icns"
  fi
}

load_env_file() {
  local env_file="$1"
  local parsed_env=""
  [[ -f "$env_file" ]] || return 0

  parsed_env="$(python3 - "$env_file" <<'PY'
import ast
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
pattern = re.compile(r'^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
for raw_line in path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#'):
        continue
    match = pattern.match(line)
    if not match:
        continue
    key, value = match.groups()
    value = value.strip()
    if value and value[0] in {'"', "'"} and value[-1] == value[0]:
        try:
            value = ast.literal_eval(value)
        except Exception:
            value = value[1:-1]
    else:
        value = value.split(' #', 1)[0].rstrip()
    print(f"{key}\t{value}")
PY
)"

  while IFS=$'\t' read -r key value; do
    [[ -n "$key" ]] || continue
    export "$key=$value"
  done <<< "$parsed_env"
}

ensure_postgres() {
  command_exists brew || fail "Homebrew is required"

  if ! brew list --versions postgresql@15 >/dev/null 2>&1; then
    fail "Homebrew formula postgresql@15 is not installed"
  fi

  local pg_isready_bin
  pg_isready_bin="$(brew --prefix postgresql@15)/bin/pg_isready"
  [[ -x "$pg_isready_bin" ]] || fail "pg_isready is missing at ${pg_isready_bin}"

  local service_state
  service_state="$(brew services list | awk '$1 == "postgresql@15" { print $2 }')"
  if [[ "$service_state" == "started" ]]; then
    log "PostgreSQL service already started"
  else
    brew services start postgresql@15 >/dev/null
    : > "$POSTGRES_STAMP"
    log "Started PostgreSQL service via Homebrew"
  fi

  local attempt
  for attempt in {1..60}; do
    if "$pg_isready_bin" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      log "PostgreSQL is ready"
      return
    fi
    sleep 1
  done

  fail "PostgreSQL did not become ready"
}

start_daemon() {
  local pid=""
  if [[ -f "$DAEMON_PID_FILE" ]]; then
    pid="$(tr -d '[:space:]' < "$DAEMON_PID_FILE")"
    if pid_running "$pid"; then
      log "Standalone daemon already running with PID ${pid}; waiting for health"
      for _ in {1..30}; do
        if engine_healthy; then
          log "Pyrfor Engine is healthy"
          return
        fi
        sleep 1
      done
      if [[ -z "$(listener_pid)" ]]; then
        python3 - "$pid" <<'PY'
import os
import signal
import sys

os.kill(int(sys.argv[1]), signal.SIGTERM)
PY
        for _ in {1..10}; do
          pid_running "$pid" || break
          sleep 1
        done
        rm -f "$DAEMON_PID_FILE"
        log "Removed stale daemon process ${pid}"
      else
        fail "Existing daemon process is unhealthy"
      fi
    else
      rm -f "$DAEMON_PID_FILE"
      log "Removed stale daemon PID file"
    fi
  fi

  local existing_listener
  existing_listener="$(listener_pid || true)"
  if [[ -n "$existing_listener" ]]; then
    log "Port ${DAEMON_PORT} already has listener PID ${existing_listener}; waiting for health"
    for _ in {1..30}; do
      if engine_healthy; then
        printf '%s\n' "$existing_listener" > "$DAEMON_PID_FILE"
        log "Pyrfor Engine is healthy on existing listener"
        return
      fi
      sleep 1
    done
    fail "Port ${DAEMON_PORT} is occupied by an unhealthy listener"
  fi

  log "Starting standalone Pyrfor Engine daemon"
  (
    cd "$REPO_DIR"
    load_env_file "$REPO_DIR/.env"
    load_env_file "$REPO_DIR/.env.local"
    export PYRFOR_DAEMON_PORT="$DAEMON_PORT"
    nohup npx tsx daemon/index.ts >>"$DAEMON_STDOUT_LOG" 2>>"$DAEMON_STDERR_LOG" < /dev/null &
    printf '%s\n' "$!" > "$DAEMON_PID_FILE"
  )

  local started_pid
  started_pid="$(tr -d '[:space:]' < "$DAEMON_PID_FILE")"
  log "Standalone daemon launched with PID ${started_pid}"

  for _ in {1..60}; do
    if engine_healthy; then
      local current_listener
      current_listener="$(listener_pid || true)"
      if [[ -n "$current_listener" ]]; then
        printf '%s\n' "$current_listener" > "$DAEMON_PID_FILE"
      fi
      log "Pyrfor Engine is healthy"
      return
    fi
    sleep 1
  done

  fail "Pyrfor Engine did not become healthy"
}

open_ide() {
  [[ -d "$PYRFOR_APP_PATH" ]] || fail "Missing ${PYRFOR_APP_PATH}"

  if ide_running; then
    log "Pyrfor.app already running"
  else
    open -a "$PYRFOR_APP_PATH"
    log "Opened ${PYRFOR_APP_PATH}"
  fi

  for _ in {1..30}; do
    if ide_running; then
      log "Pyrfor.app is running"
      return
    fi
    sleep 1
  done

  fail "Pyrfor.app did not start"
}

main() {
  log "Launcher starting"
  if [[ "$LAUNCHD_MODE" != "--launchd" ]]; then
    create_launch_app
    load_launch_agent
  else
    write_launch_agent
  fi
  ensure_postgres
  if engine_healthy; then
    local current_listener
    current_listener="$(listener_pid || true)"
    if [[ -n "$current_listener" ]]; then
      printf '%s\n' "$current_listener" > "$DAEMON_PID_FILE"
    fi
    log "Pyrfor Engine already healthy"
  else
    start_daemon
  fi
  open_ide
  notify_done
  log "Launcher completed"
}

notify_done() {
  osascript -e 'display notification "PostgreSQL · Daemon · IDE — все сервисы запущены" with title "Pyrfor готов"' >/dev/null 2>&1 || true
}

main "$@"
