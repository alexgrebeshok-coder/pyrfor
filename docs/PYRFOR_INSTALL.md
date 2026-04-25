# Pyrfor Install Guide

## What is Pyrfor

Pyrfor (`@ceoclaw/engine`) is the standalone AI runtime daemon extracted from CeoClaw — it boots a Telegram bot, HTTP gateway, cron scheduler, and full tool set (exec/read/write/browser/web-search/subagents) as a single launchd/systemd service. It reads your existing `~/.openclaw/workspace/` files unchanged, so no migration is needed. It replaces the OpenClaw daemon (`openclaw`) as Alex's daily AI assistant.

---

## One-shot install (macOS, this repo)

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev/packages/engine
npm install
npm run build
node bin/pyrfor.cjs service install \
  --workdir /Users/aleksandrgrebeshok/ceoclaw-dev \
  --env-file /Users/aleksandrgrebeshok/ceoclaw-dev/.env

# Verify the LaunchAgent is registered
node bin/pyrfor.cjs service status
```

> **Note:** The `.env` file must contain `TELEGRAM_BOT_TOKEN` (and at least one AI provider key) for the daemon to stay running. Without them the process exits immediately — add the token then restart with `launchctl kickstart gui/$(id -u)/dev.pyrfor.runtime`.

---

## Daily commands

| Action | Command |
|--------|---------|
| Interactive chat | `node bin/pyrfor.cjs chat` |
| One-shot prompt | `node bin/pyrfor.cjs --once "your prompt"` |
| Daemon status | `node bin/pyrfor.cjs service status` |
| Restart daemon | `launchctl kickstart -k gui/$(id -u)/dev.pyrfor.runtime` |
| Uninstall service | `node bin/pyrfor.cjs service uninstall` |

All commands must be run from `packages/engine/` or with the full path to `bin/pyrfor.cjs`.

---

## Workspace files it reads

Pyrfor loads the following files from `~/.openclaw/workspace/` on every boot (all optional — missing files are silently skipped):

| File | Purpose |
|------|---------|
| `SOUL.md` | Core personality / values |
| `MEMORY.md` | Long-term persistent memory |
| `USER.md` | Facts about the user |
| `IDENTITY.md` | Assistant identity / role card |
| `AGENTS.md` | Sub-agent definitions |
| `HEARTBEAT.md` | Recurring heartbeat prompt |
| `TOOLS.md` | Custom tool descriptions |
| `memory/YYYY-MM-DD.md` | Daily notes (today + yesterday loaded automatically) |
| `SKILL*.md` | Skill files (all matches loaded recursively) |

**No migration needed** — Pyrfor reads the same `~/.openclaw/workspace/` directory that OpenClaw uses. Paths are fully compatible.

---

## Provider env vars

Set these in your `.env` (or export them before starting the service):

| Variable | Provider | Notes |
|----------|---------|-------|
| `ZAI_API_KEY` | ZAI / ZukiJourney proxy | Primary — tried first |
| `ZHIPU_API_KEY` | Zhipu AI (api.z.ai) | Also primary; `ZAI_API_KEY` doubles as this if identical |
| `OPENROUTER_API_KEY` | OpenRouter | Fallback #2 — large model selection |
| `OLLAMA_URL` | Ollama (local) | Fallback #3, default `http://localhost:11434` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API | **Required** for `--telegram` daemon mode |

**Fallback chain order** (from `provider-router.ts`): `zhipu → zai → openrouter → ollama → gigachat → yandexgpt`. The router skips any provider whose key is missing and circuit-breaks on repeated failures.

---

## How to switch from OpenClaw

1. **Install Pyrfor** — run the one-shot install above (with `TELEGRAM_BOT_TOKEN` in `.env`).
2. **Verify Telegram** — send `/start` to your bot; confirm it replies.
3. **Stop OpenClaw** — unload the OpenClaw LaunchAgent:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.openclaw.daemon.plist
   ```
   (adjust plist filename to match your OpenClaw install).
4. **Confirm Pyrfor is running** — `node bin/pyrfor.cjs service status` should show `"running": true`.

---

## Troubleshooting

**Provider fails / "no providers available"**
: Check that at least one API key is in `.env` and the service was reinstalled after editing it (`service uninstall && service install`). Run `node bin/pyrfor.cjs --once "ping"` in a shell with keys exported to test outside launchd.

**Telegram is silent / bot doesn't reply**
: Verify `TELEGRAM_BOT_TOKEN` is correct and present in the `.env` used at install time. Check `~/Library/Logs/pyrfor-runtime/stderr.log` — a "TELEGRAM_BOT_TOKEN not set" line means the env var wasn't picked up by launchd. Reinstall the service after fixing `.env`.

**Log location**
: `~/Library/Logs/pyrfor-runtime/stdout.log` and `~/Library/Logs/pyrfor-runtime/stderr.log`. Tail in real-time with `tail -f ~/Library/Logs/pyrfor-runtime/stderr.log`.
