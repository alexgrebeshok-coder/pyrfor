# Migration from `daemon/` to Pyrfor Runtime

> **Status:** Planned — `daemon/` is still present and functional.
> This document is the authoritative guide for the cutover.
>
> Target package: `packages/engine` (`@ceoclaw/engine`)
> Runtime entry point: `packages/engine/src/runtime/`

---

## Table of Contents

1. [Background](#background)
2. [daemon/ inventory](#daemon-inventory)
3. [Mapping table](#mapping-table)
4. [Items not yet migrated](#items-not-yet-migrated)
5. [Migration steps for users](#migration-steps-for-users)
6. [Rollback plan](#rollback-plan)
7. [Cutover criteria](#cutover-criteria)
8. [Deletion checklist](#deletion-checklist)

---

## Background

The `daemon/` directory at the repository root is the original **CEOClaw daemon** — a
standalone TypeScript process that bootstrapped Telegram, cron, health monitoring, and an
HTTP gateway. It grew organically and accumulated direct Prisma calls, tight coupling to the
Next.js monorepo internals, and a `node-telegram-bot-api` dependency that is no longer
maintained.

The **Pyrfor Runtime** (`packages/engine/src/runtime/`) is a clean-room rewrite that:

- Lives inside the `@ceoclaw/engine` package — importable as a library *or* runnable as a
  CLI / OS service.
- Replaces `node-telegram-bot-api` with **grammY** (actively maintained, proper middleware).
- Moves all configuration to `~/.pyrfor/runtime.json` (user-scoped, hot-reloadable).
- Adds Prometheus metrics, OpenAPI spec, session migration tooling, and Docker support.
- Ships a one-button `install.sh` and `uninstall.sh`.

The daemon is kept alive during a **30-day parallel-run period** to allow live verification
before deletion.

---

## daemon/ inventory

Inspected with `ls daemon/` and `find daemon -maxdepth 2 -type d` on 2026-04-24.

| Path | Type | Description |
|---|---|---|
| `daemon/config.ts` | file | CEOClaw configuration system — Zod schema, JSON loading, env overrides, hot-reload via `fs.watchFile`. |
| `daemon/cron/` | directory | Cron sub-system (2 files). |
| `daemon/cron/service.ts` | file | `CronService` powered by `croner`; Prisma-backed job storage, execution history. |
| `daemon/cron/handlers.ts` | file | Concrete cron handlers: heartbeat scheduler, morning brief, task/project digests. |
| `daemon/gateway.ts` | file | HTTP gateway: health/status endpoints, AI chat proxy, RPC for the Next.js app, cron/Telegram/voice management. |
| `daemon/health.ts` | file | `HealthMonitor`: typed subsystem tracking, restart triggers, HTTP `/health` endpoint. |
| `daemon/index.ts` | file | Daemon entry point — bootstraps all sub-systems in order; also handles `install`/`uninstall`/`status` sub-commands. |
| `daemon/logger.ts` | file | Structured logger (`createLogger` factory); used by all daemon modules. |
| `daemon/memory/` | directory | **Empty directory** — no source files. Reserved (possibly for a memory/vector-store layer that was never implemented). |
| `daemon/service.ts` | file | OS service manager — macOS LaunchAgent / Linux systemd user unit; synchronous `execSync`-based implementation. |
| `daemon/telegram/` | directory | Telegram sub-system (3 files). |
| `daemon/telegram/bot.ts` | file | grammY bot wiring: middleware chain, rate limiting, sequentialisation, session state, command dispatch, ACL. |
| `daemon/telegram/handlers.ts` | file | Message/command handlers: `/start`, `/help`, AI query, `/tasks`, `/projects`, `add_task`, morning brief. |
| `daemon/telegram/voice.ts` | file | Voice message handler: download OGG → convert (ffmpeg) → transcribe (Whisper API). |

### Top-level daemon/ structure (summary)

```
daemon/
├── config.ts          # Configuration
├── gateway.ts         # HTTP gateway
├── health.ts          # Health monitor
├── index.ts           # Entry point
├── logger.ts          # Shared logger
├── service.ts         # OS service manager
├── memory/            # (empty)
├── cron/
│   ├── service.ts     # Scheduler
│   └── handlers.ts    # Job implementations
└── telegram/
    ├── bot.ts         # Bot wiring (grammY)
    ├── handlers.ts    # Command/message handlers
    └── voice.ts       # Voice transcription
```

---

## Mapping table

| `daemon/` source | `packages/engine/src/runtime/` target | Notes |
|---|---|---|
| `daemon/config.ts` | `runtime/config.ts` | Config schema extended; path changed to `~/.pyrfor/runtime.json`. |
| `daemon/cron/service.ts` | `runtime/cron.ts` | API-compatible; async-first rewrite. |
| `daemon/cron/handlers.ts` | `runtime/cron/handlers.ts` | Ported; Prisma calls go through `runtime/prisma-adapter.ts`. |
| `daemon/gateway.ts` | `runtime/gateway.ts` | Added bearer-token auth, OpenAI-compatible `/v1/chat` route, OpenAPI spec. |
| `daemon/health.ts` | `runtime/health.ts` | Same semantics; exported as `HealthMonitor` class. |
| `daemon/index.ts` | `runtime/index.ts` + `runtime/cli.ts` | Lifecycle split: `PyrforRuntime` class (library) + `cli.ts` (process entry point). |
| `daemon/logger.ts` | `src/observability/logger.ts` | Promoted to monorepo-shared logger; re-exported from `runtime/`. |
| `daemon/memory/` | *(no target — empty)* | No content to migrate. |
| `daemon/service.ts` | `runtime/service.ts` | Rewritten async-first, ESM-native; label changed to `dev.pyrfor.runtime`. |
| `daemon/telegram/bot.ts` | `runtime/cli.ts` + `runtime/telegram/handlers.ts` | Bot lifecycle in `cli.ts`; handlers extracted to `telegram/handlers.ts`. |
| `daemon/telegram/handlers.ts` | `runtime/telegram/handlers.ts` | Extended with ACL and additional commands. |
| `daemon/telegram/voice.ts` | `runtime/voice.ts` | Whisper language now configurable via `runtime.json`. |

---

## Items not yet migrated

| Item | Status | Notes |
|---|---|---|
| `daemon/memory/` | **N/A** | Directory is empty — nothing to migrate. |
| Prisma direct calls in `daemon/cron/handlers.ts` | **Done** | Abstracted behind `runtime/prisma-adapter.ts`. |
| `com.ceoclaw.daemon` LaunchAgent label | **Done** | Renamed to `dev.pyrfor.runtime` in `runtime/service.ts`. |
| Any daemon-specific env vars (`CEOCLAW_*`) | **TBD** | Audit your shell profile for `CEOCLAW_*` exports and replace with `PYRFOR_*` equivalents documented in `src/runtime/README.md`. |
| Webhook mode for Telegram | **TBD** | Config schema supports `mode: "webhook"` but end-to-end webhook registration flow has not been re-verified in the runtime. Polling mode is fully tested. |

---

## Migration steps for users

> **Prerequisites:** Node.js ≥ 20, pnpm installed, repo cloned.
> Run every command from the **repository root** unless otherwise noted.

### Step 1 — Stop the existing daemon

**macOS (LaunchAgent):**
```bash
# Find the label used by the old daemon
launchctl list | grep ceoclaw

# Boot it out (replace <uid> with your user ID from `id -u`)
launchctl bootout gui/$(id -u)/com.ceoclaw.daemon 2>/dev/null || true

# If the plist was loaded from a file:
launchctl unload ~/Library/LaunchAgents/com.ceoclaw.daemon.plist 2>/dev/null || true
```

**Linux (systemd):**
```bash
systemctl --user stop ceoclaw-daemon.service 2>/dev/null || true
systemctl --user disable ceoclaw-daemon.service 2>/dev/null || true
```

**Confirm the daemon process is gone:**
```bash
pgrep -fl "daemon/index" && echo "still running — kill it" || echo "stopped OK"
```

---

### Step 2 — Install the Pyrfor Runtime

**One-button install (recommended):**
```bash
bash packages/engine/scripts/install.sh
```

The script will:
1. Verify Node.js ≥ 20 and pnpm.
2. Warn if `ffmpeg` or `whisper-cli` are absent (needed only for voice).
3. Run `pnpm install --filter @ceoclaw/engine...`.
4. Create `~/.pyrfor/` (mode 0700) and generate `~/.pyrfor/runtime.json` with a random
   gateway bearer token.
5. Optionally register Pyrfor as a background service.

**Flags:**
```
--non-interactive    Skip all prompts; use defaults.
--help               Show usage.
```

**Manual install:**
```bash
pnpm install --filter "@ceoclaw/engine..."
mkdir -p ~/.pyrfor/sessions
chmod 0700 ~/.pyrfor
# Copy/edit ~/.pyrfor/runtime.json — see src/runtime/README.md for schema.
```

---

### Step 3 — Migrate legacy sessions

If you have existing sessions from the old daemon or OpenClaw:

```bash
# Dry-run first — shows what would be imported
npx tsx packages/engine/src/runtime/migrate-sessions.ts --dry-run

# Live migration
npx tsx packages/engine/src/runtime/migrate-sessions.ts

# Or via the CLI sub-command (after service install):
pyrfor-runtime migrate sessions
```

Scanned locations:
- `~/.openclaw/sessions/*.sqlite` / `*.db` — SQLite stores (requires `better-sqlite3`).
- `~/.ceoclaw/sessions/**/*.json` — legacy JSON session files.
- `~/.openclaw/memory/*.json` — **skipped** (free-form memory dumps, not session records).

Imported sessions are written to `~/.pyrfor/sessions/<uuid>.json`.

---

### Step 4 — Start Pyrfor Runtime and verify `/health`

```bash
# Foreground test run
npx tsx packages/engine/src/runtime/cli.ts

# In a separate terminal:
curl -s http://localhost:4242/health | jq .
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 5.2,
  "subsystems": {
    "config":   { "ok": true },
    "telegram": { "ok": true },
    "cron":     { "ok": true },
    "gateway":  { "ok": true }
  }
}
```

If any subsystem shows `"ok": false`, check the runtime log output and your
`~/.pyrfor/runtime.json` configuration before proceeding.

---

### Step 5 — Remove the old daemon from launchd / systemd

Once `/health` returns OK and you have verified Telegram and cron functionality (see
[Cutover criteria](#cutover-criteria)):

**macOS:**
```bash
# Remove old plist file (adjust filename to match yours)
rm -f ~/Library/LaunchAgents/com.ceoclaw.daemon.plist
# Confirm it no longer appears
launchctl list | grep ceoclaw
```

**Linux:**
```bash
# Remove old unit file
rm -f ~/.config/systemd/user/ceoclaw-daemon.service
systemctl --user daemon-reload
```

---

## Rollback plan

If issues are found during the parallel-run period, roll back as follows:

### Revert to daemon (quick rollback)

```bash
# 1. Stop Pyrfor Runtime
pyrfor-runtime service stop 2>/dev/null || \
  launchctl bootout gui/$(id -u)/dev.pyrfor.runtime

# 2. Re-enable old daemon plist (if you kept it)
launchctl load ~/Library/LaunchAgents/com.ceoclaw.daemon.plist

# 3. Verify daemon is back
curl -s http://localhost:<daemon-port>/health
```

### Archive daemon/ for future reference

`daemon/` will be kept in the repository for **30 days** after the Pyrfor Runtime goes
live in production. After that, it will be:

1. Archived:
   ```bash
   mkdir -p ~/.openclaw-archive
   cp -r daemon/ ~/.openclaw-archive/daemon-$(date +%Y%m%d)/
   ```
2. Deleted from the repository in a dedicated commit:
   ```
   chore(daemon): delete legacy daemon/ after 30-day parallel run
   ```

The archive in `~/.openclaw-archive/` is **never** deleted automatically — keep it as long
as needed.

---

## Cutover criteria

All of the following must be true before `daemon/` is deleted:

| Criterion | How to verify |
|---|---|
| **Divergence == 0** for ≥ 7 consecutive days | Both daemon and runtime produce identical `/health` responses; no daemon-only alerts. |
| **All automated tests pass** | `pnpm --filter @ceoclaw/engine test` exits 0 (unit + e2e). |
| **Telegram functionality verified live** | `/start`, `/help`, AI query, `/tasks`, voice transcription all respond correctly in the production chat. |
| **Cron functionality verified live** | Agent heartbeat and morning brief cron jobs fire on schedule and produce expected output. |
| **Session continuity confirmed** | At least one session migrated from the old daemon is accessible and coherent in the runtime. |
| **`/health` returns `"status": "ok"`** | All subsystem checks pass for ≥ 24 h without manual intervention. |
| **Prometheus `/metrics` baseline established** | `pyrfor_uptime_seconds` and cron-job counters have been stable for ≥ 24 h. |
| **No rollback events** | No `pyrfor-runtime service stop` + daemon restart in the 30-day window. |

Once all criteria are met, open a PR with the deletion commit and reference this file.

---

## Deletion checklist

Use this as the PR checklist when deleting `daemon/`:

- [ ] All cutover criteria above are met.
- [ ] `daemon/` archived to `~/.openclaw-archive/daemon-<date>/` on the production host.
- [ ] `git rm -r daemon/` committed with message:
  `chore(daemon): delete legacy daemon/ after 30-day parallel run`.
- [ ] `CHANGELOG.md` updated: move "Removed" entry from `[Unreleased]` to the new release
  section.
- [ ] Any remaining references to `daemon/` in `README.md`, CI, or `package.json` scripts
  are removed or redirected.
- [ ] `~/.openclaw-archive/` retention reminder added to the host's runbook.
