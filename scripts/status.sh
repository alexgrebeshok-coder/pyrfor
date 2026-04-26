#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/pyrfor-dev/logs"
STATUS_LOG="$LOG_DIR/status.log"
DAEMON_PID_FILE="$LOG_DIR/pyrfor-daemon.pid"
PLIST_PATH="$HOME/Library/LaunchAgents/com.pyrfor.launch.plist"
LAUNCH_AGENT_LABEL="com.pyrfor.launch"
LAUNCH_APP_PATH="/Applications/Pyrfor Launch.app"
PYRFOR_APP_PATH="/Applications/Pyrfor.app"
DAEMON_PORT="18790"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

mkdir -p "$LOG_DIR"
touch "$STATUS_LOG"

log() {
  local timestamp
  timestamp="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$timestamp" "$*" | tee -a "$STATUS_LOG"
}

listener_pid() {
  lsof -nP -iTCP:"$DAEMON_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

engine_healthy() {
  curl -sf "http://127.0.0.1:${DAEMON_PORT}/health" >/dev/null 2>&1
}

ide_running() {
  osascript -e 'application id "dev.pyrfor.ide" is running' 2>/dev/null | grep -q '^true$'
}

launch_agent_loaded() {
  launchctl print "gui/$(id -u)/${LAUNCH_AGENT_LABEL}" >/dev/null 2>&1
}

postgres_service_state() {
  if ! command -v brew >/dev/null 2>&1; then
    printf 'brew-missing'
    return
  fi
  local state
  state="$(brew services list | awk '$1 == "postgresql@15" { print $2 }')"
  printf '%s' "${state:-not-installed}"
}

postgres_ready() {
  command -v brew >/dev/null 2>&1 || return 1
  local pg_isready_bin
  pg_isready_bin="$(brew --prefix postgresql@15 2>/dev/null)/bin/pg_isready"
  [[ -x "$pg_isready_bin" ]] && "$pg_isready_bin" -h 127.0.0.1 -p 5432 >/dev/null 2>&1
}

main() {
  local exit_code=0
  local postgres_state
  local daemon_listener_pid
  local daemon_pid_file_value="missing"
  local daemon_command=""
  local sidecar_info="informational only (standalone daemon is primary target)"

  postgres_state="$(postgres_service_state)"
  if postgres_ready; then
    log "PostgreSQL: ready (brew service: ${postgres_state})"
  else
    log "PostgreSQL: NOT ready (brew service: ${postgres_state})"
    exit_code=1
  fi

  daemon_listener_pid="$(listener_pid || true)"
  if [[ -f "$DAEMON_PID_FILE" ]]; then
    daemon_pid_file_value="$(tr -d '[:space:]' < "$DAEMON_PID_FILE")"
  fi

  if [[ -n "$daemon_listener_pid" ]]; then
    daemon_command="$(ps -p "$daemon_listener_pid" -o command= 2>/dev/null | sed 's/^ *//')"
    if [[ "$daemon_command" == *"/Applications/Pyrfor.app/"* || "$daemon_command" == *"pyrfor-daemon"* ]]; then
      sidecar_info="listener appears app-managed (${daemon_command})"
    elif [[ -n "$daemon_command" ]]; then
      sidecar_info="listener command: ${daemon_command}"
    fi
  fi

  if engine_healthy; then
    log "Engine: healthy (listener PID: ${daemon_listener_pid:-none}, pid file: ${daemon_pid_file_value})"
  else
    log "Engine: UNHEALTHY (listener PID: ${daemon_listener_pid:-none}, pid file: ${daemon_pid_file_value})"
    exit_code=1
  fi

  if ide_running; then
    log "IDE: running (${PYRFOR_APP_PATH})"
  else
    log "IDE: not running (${PYRFOR_APP_PATH})"
  fi

  log "Sidecar fallback: ${sidecar_info}"
  log "Launch app: $([[ -d "$LAUNCH_APP_PATH" ]] && echo installed || echo missing) (${LAUNCH_APP_PATH})"
  log "LaunchAgent plist: $([[ -f "$PLIST_PATH" ]] && echo installed || echo missing) (${PLIST_PATH})"
  if launch_agent_loaded; then
    log "LaunchAgent loaded: yes"
  else
    log "LaunchAgent loaded: no"
  fi

  notify_summary "$exit_code"

  exit "$exit_code"
}

notify_summary() {
  local code="$1"
  local pg_state ide_state engine_state title body
  pg_state="$(postgres_ready && echo '✅ PostgreSQL' || echo '❌ PostgreSQL')"
  engine_state="$(engine_healthy && echo '✅ Daemon' || echo '❌ Daemon')"
  ide_state="$(ide_running && echo '✅ IDE' || echo '⚪ IDE')"
  if [[ "$code" -eq 0 ]]; then
    title="Pyrfor: всё работает"
  else
    title="Pyrfor: есть проблемы"
  fi
  body="${pg_state}  ·  ${engine_state}  ·  ${ide_state}"
  osascript -e "display notification \"${body}\" with title \"${title}\"" >/dev/null 2>&1 || true
}

main "$@"
