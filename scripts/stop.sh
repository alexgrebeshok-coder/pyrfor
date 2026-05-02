#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/pyrfor-dev/logs"
STOP_LOG="$LOG_DIR/stop.log"
DAEMON_PID_FILE="$LOG_DIR/pyrfor-daemon.pid"
POSTGRES_STAMP="$LOG_DIR/postgresql@15.started-by-launcher"
DAEMON_PORT="18790"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

mkdir -p "$LOG_DIR"
touch "$STOP_LOG"

log() {
  local timestamp
  timestamp="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '%s %s\n' "$timestamp" "$*" | tee -a "$STOP_LOG"
}

pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1
}

listener_pid() {
  lsof -nP -iTCP:"$DAEMON_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

daemon_command_matches() {
  local pid="$1"
  local command_line
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *"/Users/aleksandrgrebeshok/pyrfor-dev"* ]] ||
    [[ "$command_line" == *"daemon/index.ts"* ]] ||
    [[ "$command_line" == *"pyrfor-daemon"* ]]
}

ide_running() {
  osascript -e 'application id "dev.pyrfor.ide" is running' 2>/dev/null | grep -q '^true$'
}

quit_ide() {
  if ide_running; then
    osascript -e 'tell application id "dev.pyrfor.ide" to quit'
    log "Requested Pyrfor.app quit"
    for _ in {1..30}; do
      if ! ide_running; then
        log "Pyrfor.app stopped"
        return
      fi
      sleep 1
    done
    log "Pyrfor.app still appears to be running"
  else
    log "Pyrfor.app already stopped"
  fi
}

terminate_pid() {
  python3 - "$1" <<'PY'
import os
import signal
import sys

os.kill(int(sys.argv[1]), signal.SIGTERM)
PY
}

stop_daemon() {
  local pid=""
  if [[ -f "$DAEMON_PID_FILE" ]]; then
    pid="$(tr -d '[:space:]' < "$DAEMON_PID_FILE")"
    if ! pid_running "$pid"; then
      log "Ignoring stale compatibility daemon PID file (${pid})"
      pid=""
      rm -f "$DAEMON_PID_FILE"
    fi
  fi

  if [[ -z "$pid" ]]; then
    pid="$(listener_pid || true)"
  fi

  if [[ -z "$pid" ]]; then
    log "No compatibility daemon listener found on port ${DAEMON_PORT}"
    return
  fi

  if ! daemon_command_matches "$pid"; then
    log "Refusing to stop PID ${pid}: listener on ${DAEMON_PORT} does not look like Pyrfor Engine"
    exit 1
  fi

  terminate_pid "$pid"
  log "Sent TERM to compatibility daemon PID ${pid}"
  for _ in {1..30}; do
    if ! pid_running "$pid"; then
      rm -f "$DAEMON_PID_FILE"
      log "Compatibility daemon PID ${pid} stopped"
      return
    fi
    sleep 1
  done

  log "Compatibility daemon PID ${pid} did not stop after TERM"
  exit 1
}

stop_postgres_if_owned() {
  if [[ ! -f "$POSTGRES_STAMP" ]]; then
    log "PostgreSQL ownership stamp not present; leaving service untouched"
    return
  fi

  if ! command -v brew >/dev/null 2>&1; then
    log "Homebrew not available; cannot stop PostgreSQL"
    exit 1
  fi

  brew services stop postgresql@15 >/dev/null
  rm -f "$POSTGRES_STAMP"
  log "Stopped PostgreSQL service started by launcher"
}

main() {
  quit_ide
  stop_daemon
  stop_postgres_if_owned
}

main "$@"
