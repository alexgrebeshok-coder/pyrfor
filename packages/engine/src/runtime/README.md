# Pyrfor Runtime

## Overview

Pyrfor Runtime is a modular, self-contained AI-assistant engine that wires together a Telegram bot, an OpenAI-compatible HTTP gateway, a cron scheduler, a health monitor, and persistent session management — all driven by a single JSON config file. Drop it into any Node.js project as a library, launch it from the command line, or install it as a macOS LaunchAgent / Linux systemd service. Sessions survive restarts via atomic JSON files; the config file is hot-reloaded at runtime without a process restart.

---

## Installation

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/<repo>/main/packages/engine/scripts/install.sh | bash
```

> Replace `<repo>` with the full `owner/repository` path, e.g. `myorg/ceoclaw`.

The script will:
1. Check Node.js ≥ 20 and pnpm (offers to install pnpm if missing).
2. Warn about optional deps (`ffmpeg`, `whisper-cli`).
3. Run `pnpm install --filter @ceoclaw/engine...` from the repo root.
4. Create `~/.pyrfor/` (mode 0700) and generate `~/.pyrfor/runtime.json` with a random gateway bearer token.
5. Optionally register Pyrfor as a background service (macOS LaunchAgent or Linux systemd user unit).

**Flags:**

| Flag | Description |
|---|---|
| `--non-interactive` | Skip all prompts, use defaults (no token prompts, no service install). |
| `--help` | Print usage and exit. |

### Manual install

```bash
# 1. Install dependencies from the repo root
pnpm install --filter "@ceoclaw/engine..."

# 2. Create config directory
mkdir -p ~/.pyrfor/sessions
chmod 0700 ~/.pyrfor

# 3. Create ~/.pyrfor/runtime.json  (see Configuration section below for schema)

# 4. Start the runtime
cd <repo-root>
npx tsx packages/engine/src/runtime/cli.ts

# 5. (Optional) install as background service
npx tsx packages/engine/src/runtime/cli.ts service install --workdir <repo-root>
```

### Uninstall

```bash
bash packages/engine/scripts/uninstall.sh
```

Or one-line:

```bash
curl -fsSL https://raw.githubusercontent.com/<repo>/main/packages/engine/scripts/uninstall.sh | bash
```

The uninstaller stops the service, then **optionally** deletes `~/.pyrfor/` (prompts before deleting).

---

## Docker Deploy

The engine ships with a multi-stage Dockerfile and a `docker-compose.yml`
located in `packages/engine/`. The build context is the **repo root** so pnpm
can read the full workspace lockfile.

### One-command build & run

```bash
cd packages/engine

# Build the image (run from repo root so workspace files are in context)
docker build -f Dockerfile -t pyrfor:latest ../../

# Run the container
docker run -d \
  -p 18790:18790 \
  -v $(pwd)/pyrfor-config:/etc/pyrfor \
  -v $(pwd)/pyrfor-data:/var/lib/pyrfor \
  --env-file .env \
  pyrfor:latest
```

> **Config:** put your `runtime.json` inside `./pyrfor-config/` before starting.
> See the [Configuration](#configuration) section for the full schema.

### docker compose (recommended)

```bash
cd packages/engine

# 1. Create config directory and drop in runtime.json
mkdir -p pyrfor-config pyrfor-data
# cp /path/to/your/runtime.json pyrfor-config/runtime.json

# 2. Create .env with secrets (TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, etc.)
# cp .env.example .env && $EDITOR .env

# 3. Start in the background
docker compose up -d

# Stream logs
docker compose logs -f

# Stop
docker compose down
```

### Overriding the sessions path

Mount any host path and point the runtime at it via an env var — no
volume-mount change required:

```bash
docker run ... -e PYRFOR_SESSIONS_PATH=/mnt/nfs/sessions pyrfor:latest
```

Or in `.env`:

```
PYRFOR_SESSIONS_PATH=/var/lib/pyrfor
```

---

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │          runtime.json config         │
                    │  (~/.pyrfor/runtime.json, hot-reload) │
                    └──────────────────┬──────────────────┘
                                       │ loadConfig / watchConfig
                                       ▼
                    ┌─────────────────────────────────────┐
                    │           PyrforRuntime              │
                    │  (packages/engine/src/runtime/index) │
                    └──┬────┬─────┬──────┬────────┬───────┘
                       │    │     │      │        │
            ┌──────────┘    │     │      │        └──────────┐
            ▼               ▼     ▼      ▼                   ▼
   ┌──────────────┐  ┌────────┐ ┌─────────────┐  ┌──────────────────┐
   │HealthMonitor │  │  Cron  │ │   Gateway   │  │  SessionManager  │
   │  (health.ts) │  │Service │ │ (gateway.ts)│  │   + SessionStore │
   └──────────────┘  │(cron.ts│ │  HTTP :18790│  │  (session*.ts)   │
                     └────────┘ └─────────────┘  └──────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
       ┌──────────┐ ┌──────────┐ ┌──────────────┐
       │ Telegram │ │  Voice   │ │   Service    │
       │  Bot     │ │(voice.ts)│ │ (service.ts) │
       │(cli.ts)  │ └──────────┘ └──────────────┘
       └──────────┘
```

---

## Quick Start

### As a library

> **Note:** `@ceoclaw/engine` does not yet export a `/runtime` sub-path in its `package.json` `"exports"` map. Import directly from the source path or build output until the export is added.

```typescript
import { PyrforRuntime } from '@ceoclaw/engine/src/runtime/index';
// or from compiled output:
// import { PyrforRuntime } from '@ceoclaw/engine/dist/runtime/index';

const runtime = new PyrforRuntime({
  configPath: '~/.pyrfor/runtime.json',   // hot-reloaded on file change
  workspacePath: '~/.openclaw/workspace', // SOUL.md / IDENTITY.md / MEMORY.md
});

await runtime.start();

const result = await runtime.handleMessage(
  'api',        // channel
  'user-123',   // userId
  'chat-456',   // chatId
  'Hello, world!'
);

console.log(result.response);

// On exit
process.on('SIGTERM', async () => {
  await runtime.stop();
  process.exit(0);
});
```

**`PyrforRuntimeOptions` reference:**

| Option | Type | Default | Description |
|---|---|---|---|
| `configPath` | `string` | — | Path to `runtime.json`; hot-reloaded. |
| `config` | `RuntimeConfig` | schema defaults | Pre-parsed config (used when `configPath` absent). |
| `workspacePath` | `string` | `process.cwd()` | Workspace directory for `SOUL.md`, etc. |
| `memoryPath` | `string` | — | Memory file directory. |
| `systemPrompt` | `string` | built-in default | Override the system prompt. |
| `enableCompact` | `boolean` | `true` | Auto-compact long conversations. |
| `enableSubagents` | `boolean` | `true` | Enable background sub-agent spawning. |
| `maxSubagents` | `number` | `5` | Max concurrent sub-agents. |
| `persistence` | `SessionStoreOptions \| false` | `{}` (enabled) | Session persistence options, or `false` to disable. |
| `privacy.defaultZone` | `'public' \| 'personal' \| 'vault'` | `'personal'` | Privacy zone for new operations. |

---

### As CLI

```bash
# Interactive chat
npx tsx packages/engine/src/runtime/cli.ts --chat

# Telegram bot with custom config
npx tsx packages/engine/src/runtime/cli.ts --telegram --config ~/.pyrfor/runtime.json

# One-shot question and exit
npx tsx packages/engine/src/runtime/cli.ts --once "What tasks are overdue?"

# Daemon mode (keep-alive, no interactive I/O)
npx tsx packages/engine/src/runtime/cli.ts
```

**All CLI flags:**

| Flag | Alias | Description |
|---|---|---|
| `--chat` | | Interactive REPL mode |
| `--telegram` | | Start Telegram bot (requires `TELEGRAM_BOT_TOKEN`) |
| `--once "<msg>"` | | One-shot: print response and exit |
| `--config <path>` | `-c` | Path to `runtime.json` (default: `~/.pyrfor/runtime.json`) |
| `--workspace <path>` | `-w` | Workspace directory (default: `~/.openclaw/workspace`) |
| `--provider <name>` | `-p` | AI provider: `zai`, `openrouter`, `ollama` |
| `--model <name>` | `-m` | Model to use |
| `--help` | `-h` | Show help |

---

### As OS service

See the [Service Manager](#service-manager) section.

---

## Configuration

### Full `runtime.json` example

```jsonc
{
  // Optional: SOUL.md / IDENTITY.md workspace path
  "workspacePath": "/Users/you/.openclaw/workspace",
  // Optional: memory files directory
  "memoryPath": "/Users/you/.openclaw/memory",

  "telegram": {
    "enabled": true,
    "botToken": "123456:AABBcc...",     // or set TELEGRAM_BOT_TOKEN env var
    // Empty list = open to everyone; populate to restrict access
    "allowedChatIds": [123456789],
    "rateLimitPerMinute": 30            // sliding-window per chat
  },

  "voice": {
    "enabled": true,
    "provider": "local",               // "local" | "openai"
    // For provider "local":
    "whisperBinary": "/opt/homebrew/bin/whisper-cli",
    // For provider "openai":
    "openaiApiKey": "sk-...",          // or OPENAI_API_KEY env var
    "model": "whisper-1"               // used only for provider "openai"
  },

  "cron": {
    "enabled": true,
    "timezone": "Europe/Moscow",       // default IANA timezone for all jobs
    "jobs": [
      {
        "name": "morning-brief",
        "schedule": "0 8 * * 1-5",    // croner-compatible expression
        "handler": "morning-brief",   // must match a registered handler key
        "enabled": true,
        "timezone": "Europe/Moscow",  // per-job override (optional)
        "payload": { "chatIds": [123456789] }
      }
    ]
  },

  "health": {
    "enabled": true,
    "intervalMs": 30000               // how often to run all checks
  },

  "gateway": {
    "enabled": false,                 // set true to start HTTP server
    "host": "127.0.0.1",
    "port": 18790,
    "bearerToken": "secret-token"     // omit for no auth on protected routes
  },

  "providers": {
    "defaultProvider": "openrouter",  // zai | openrouter | ollama
    "enableFallback": true
  },

  "persistence": {
    "enabled": true,
    "rootDir": "/Users/you/.pyrfor/sessions",
    "debounceMs": 5000                // coalesce writes per session
  }
}
```

### Config file resolution order

1. `PYRFOR_CONFIG_PATH` env var (if set)
2. Path passed to `loadConfig(filePath)` / `--config` CLI flag
3. `~/.pyrfor/runtime.json` (default)
4. `~/.ceoclaw/ceoclaw.json` (legacy fallback, only when default path is missing)
5. Schema defaults (all fields optional; Zod fills in defaults)

### Environment variable overrides

Applied **after** file parsing; `PYRFOR_*` takes priority over legacy names.

| Env Var | Legacy / Alias | Overrides |
|---|---|---|
| `PYRFOR_CONFIG_PATH` | — | Config file path |
| `PYRFOR_WORKSPACE` | — | `workspacePath` |
| `PYRFOR_TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` | `telegram.botToken` |
| `PYRFOR_TELEGRAM_ALLOWED_CHAT_IDS` | `TELEGRAM_ALLOWED_CHAT_IDS` | `telegram.allowedChatIds` (comma-separated) |
| `PYRFOR_OPENAI_API_KEY` | `OPENAI_API_KEY` | `voice.openaiApiKey` |
| `PYRFOR_GATEWAY_PORT` | — | `gateway.port` |
| `PYRFOR_GATEWAY_TOKEN` | — | `gateway.bearerToken` |

### Hot-reload behaviour

`watchConfig` uses `fs.watch` (kqueue/inotify) with a 500 ms debounce.

| What changed | Effect |
|---|---|
| New cron job added | Job scheduled immediately |
| Existing cron job removed | Job stopped and removed |
| `gateway.port` changed | **Restart required** — logged as a warning |
| Everything else | `PyrforRuntime.config` updated in-place |

---

## HTTP Gateway

Enable with `gateway.enabled: true`. Binds to `gateway.host:gateway.port` (default `127.0.0.1:18790`).

### Route table

| Method | Path | Auth required | Description |
|---|---|---|---|
| `GET` | `/ping` | No | Liveness probe — returns `{"ok":true}` |
| `GET` | `/health` | No | Last `HealthSnapshot`; 503 when status is `unhealthy` |
| `GET` | `/status` | Yes | Uptime, config, cron job list, health snapshot |
| `GET` | `/cron/jobs` | Yes | Array of `CronJobStatus` objects |
| `POST` | `/cron/trigger` | Yes | Manually trigger a cron job by name |
| `POST` | `/v1/chat/completions` | Yes | OpenAI-compatible chat endpoint |
| `OPTIONS` | `*` | No | CORS preflight (permissive) |

Auth = `Authorization: Bearer <gateway.bearerToken>`. Routes return `401` when token is missing/wrong.

### curl examples

```bash
TOKEN="secret-token"
BASE="http://127.0.0.1:18790"

# Liveness
curl "$BASE/ping"

# Health snapshot
curl "$BASE/health"

# Chat (OpenAI-compatible)
curl -s -X POST "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"What time is it?"}],
    "userId": "u1",
    "chatId": "c1"
  }'

# Trigger a cron job manually
curl -s -X POST "$BASE/cron/trigger" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"morning-brief"}'
```

---

## Cron Service

Uses [croner](https://github.com/hexagon/croner) under the hood. Parallel scheduled runs of the same job are prevented (`protect: true`).

### Default handlers

Registered automatically on `PyrforRuntime.start()`. All Prisma-backed handlers log an error at execution time if `setCronPrismaClient()` was never called.

| Handler key | Description |
|---|---|
| `morning-brief` | Queries active/at-risk projects and overdue/upcoming tasks; sends a briefing to configured `chatIds`. |
| `email-digest` | Counts completed tasks, new tasks, and new risks in the last 7 days; logs a weekly digest. |
| `memory-cleanup` | Deletes expired memory rows (`validUntil < now`) and low-confidence rows not updated in 30 days. |
| `health-report` | Runs `SELECT 1` to measure DB latency; counts projects, tasks, and memories. |
| `budget-reset` | Resets `spentMonthlyCents` to 0 for all agents (run monthly). |
| `agent-heartbeat` | Processes queued wakeup requests and triggers scheduled agents via `heartbeat-scheduler`. |

### Injecting dependencies

```typescript
import { setCronPrismaClient } from '@ceoclaw/engine/src/runtime/cron/handlers';
import { setHeartbeatRunner }  from '@ceoclaw/engine/src/runtime/cron/handlers';
import { PrismaClient }        from '@prisma/client';

const prisma = new PrismaClient();
setCronPrismaClient(prisma);

// Optional: inject custom heartbeat scheduler (useful in tests)
setHeartbeatRunner(async (deps, config) => { /* ... */ });
```

### Adding custom handlers

```typescript
import { PyrforRuntime } from '...';

const runtime = new PyrforRuntime({ configPath: '...' });
await runtime.start();

// Register a custom handler before or after start()
runtime.cron!.registerHandler('my-job', async (ctx) => {
  console.log('fired at', ctx.firedAt, 'payload:', ctx.job.payload);
});

// Add a job at runtime (also works via config hot-reload)
runtime.cron!.addJob({
  name: 'my-job',
  schedule: '*/5 * * * *', // every 5 minutes
  handler: 'my-job',
  enabled: true,
  payload: { foo: 'bar' },
});
```

### Cron job JSON schema

```jsonc
{
  "name": "unique-job-id",        // string, required, must be unique
  "schedule": "0 9 * * 1-5",     // croner expression (5 or 6 fields)
  "handler": "morning-brief",     // must be a registered handler key
  "enabled": true,                // default true
  "timezone": "Europe/Moscow",    // IANA tz, overrides cron.timezone
  "payload": {}                   // arbitrary, passed as ctx.job.payload
}
```

---

## Telegram Bot

The Telegram bot is started via `--telegram` CLI flag or programmatically by running `runTelegram()` inside `cli.ts`. It uses [grammY](https://grammy.dev/) with `@grammyjs/runner` for concurrent polling.

### Slash commands

| Command | DB required | Description |
|---|---|---|
| `/start` | No | Welcome message |
| `/help` | No | Command reference |
| `/status` | Yes | Project overview: active, at-risk, progress |
| `/projects` | Yes | Full project list with priority and description |
| `/tasks` | Yes | Open/blocked tasks ordered by priority and due date |
| `/add_task <project> <title>` | Yes | Create a new task in a project |
| `/ai <question>` | No | Direct AI query through `runtime.handleMessage` |
| `/brief` | Yes | Morning briefing: overdue/upcoming tasks, blocked work |
| `/stats` | No | Runtime stats: sessions, tokens, providers, costs |
| `/clear` | No | Reset conversation context for the current chat |

Any non-command text message is forwarded directly to `runtime.handleMessage`.

### ACL

Set `telegram.allowedChatIds` in config to a non-empty list of numeric chat IDs. Messages from unlisted chats are silently dropped. An empty list allows everyone.

```bash
# Env var override (comma-separated):
PYRFOR_TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321
```

### Rate limiting

Sliding-window, per chat ID, configurable via `telegram.rateLimitPerMinute` (default `30`). Excess messages receive `⏳ Слишком много запросов.`

### Voice messages

Voice OGG files received by the bot are transcribed automatically (see [Voice Transcription](#voice-transcription)) and the resulting text is fed into `runtime.handleMessage` as a normal user message.

---

## Voice Transcription

Module: `voice.ts`. Triggered for `message:voice` updates.

### Providers

| Provider | Config value | How it works |
|---|---|---|
| OpenAI Whisper API | `"provider": "openai"` | Downloads audio from Telegram, sends to `POST /v1/audio/transcriptions` (60 s timeout). |
| Local whisper-cli | `"provider": "local"` | Downloads audio → converts to 16 kHz WAV via `ffmpeg` → runs `whisper-cli`. Default. |

### Environment variables (local provider)

| Var | Default |
|---|---|
| `WHISPER_CLI_PATH` | `/opt/homebrew/bin/whisper-cli` |
| `WHISPER_MODEL_PATH` | `~/.openclaw/models/whisper/ggml-small.bin` |
| `FFMPEG_PATH` | `/opt/homebrew/bin/ffmpeg` |

### Dependencies

- **Local provider:** `ffmpeg` + `whisper-cli` (e.g. from [whisper.cpp](https://github.com/ggerganov/whisper.cpp))
- **OpenAI provider:** `OPENAI_API_KEY` (or `PYRFOR_OPENAI_API_KEY`)

Temp files are written to `os.tmpdir()` and cleaned up after each transcription.

---

## Health Monitor

Module: `health.ts`. Runs registered async checks on a fixed interval (default 30 s). Aggregate status:

- `healthy` — all checks pass
- `degraded` — at least one **non-critical** check failing
- `unhealthy` — at least one **critical** check failing
- `unknown` — no checks registered, or monitor not yet run

### Built-in checks (registered in `PyrforRuntime.start()`)

| Check name | Critical | What it tests |
|---|---|---|
| `runtime` | No | Always healthy once `start()` completes |
| `providers` | No | At least one AI provider available |
| `gateway` | No | `GET /ping` on the gateway port responds `200` |

### Registering custom checks

```typescript
runtime.health!.addCheck(
  'database',
  async () => {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true, latencyMs: Date.now() - start };
  },
  { critical: true, timeoutMs: 5000 }
);
```

`HealthCheckResult` shape:

```typescript
{
  healthy: boolean;
  status?: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'; // inferred if absent
  message?: string;
  metadata?: Record<string, unknown>;
}
```

---

## Session Persistence

Module: `session-store.ts`.

### Storage layout

```
~/.pyrfor/sessions/
  telegram/
    123456789_123456789.json
  cli/
    cli-user_cli-chat.json
  tma/
    ...
  web/
    ...
```

One JSON file per `(channel, userId, chatId)` triple. File names are sanitized to `[A-Za-z0-9._-]`.

### Write safety

Writes are **atomic**: the store writes to `<file>.tmp` then calls `rename()` (POSIX-atomic within a filesystem). A crashed process can never leave half-written JSON.

Writes are **debounced** (default 5 s) to avoid hammering disk during rapid tool-loop message bursts.

### Startup restore

`PyrforRuntime.start()` calls `store.loadAll()` and re-hydrates all sessions into `SessionManager` before accepting messages. Failed individual sessions are skipped with a warning.

### `/clear` command

`runtime.clearSession(channel, userId, chatId)` removes the in-memory session and deletes the corresponding `.json` file from disk.

### Schema versioning

Each file stores `"schemaVersion": 1`. Files with an incompatible version are silently skipped on load.

---

## Service Manager

Module: `service.ts`. Factory: `createServiceManager()`.

### macOS (LaunchAgent)

```
~/Library/LaunchAgents/dev.pyrfor.runtime.plist
~/Library/Logs/pyrfor-runtime/stdout.log
~/Library/Logs/pyrfor-runtime/stderr.log
```

- **Label:** `dev.pyrfor.runtime`
- `RunAtLoad: true`, `KeepAlive: true` — starts on login, restarts on crash.

```typescript
import { createServiceManager } from '@ceoclaw/engine/src/runtime/service';

const svc = createServiceManager();

// Install and load
await svc.install({
  executablePath: '/usr/local/bin/node',
  args: ['/path/to/dist/runtime/cli.js', '--telegram'],
  envFile: '/etc/pyrfor/.env',          // optional .env file
  envOverrides: { LOG_LEVEL: 'info' },  // optional inline overrides
});

// Check status
const status = await svc.status();
console.log(status.running); // true / false

// Uninstall
await svc.uninstall();
```

### Linux (systemd user unit)

```
~/.config/systemd/user/pyrfor-runtime.service
```

```bash
# After install:
systemctl --user status pyrfor-runtime
journalctl --user -u pyrfor-runtime -f
```

Unit uses `Restart=always` with a 10 s restart delay.

---

## Graceful Shutdown

`PyrforRuntime.stop()` tears down subsystems in **reverse start order**, catching and logging errors from each step so a single failure does not block the rest:

1. Config file watcher disposed
2. HTTP Gateway stopped (`server.close()`)
3. CronService stopped (all croner instances stopped)
4. HealthMonitor stopped (interval cleared)
5. WorkspaceLoader disposed
6. SessionStore flushed (`flushAll()`) then closed
7. SubagentSpawner cleaned up

The CLI registers `SIGINT` and `SIGTERM` handlers that call `stop()` then `process.exit(0)`.

---

## Development

### Running tests

```bash
# All runtime tests
npx vitest run packages/engine/src/runtime/

# Single file
npx vitest run packages/engine/src/runtime/health.test.ts

# Watch mode
npx vitest packages/engine/src/runtime/
```

### Type checking

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json
```

> **Note:** `daemon-runtime-gap.md` does not currently exist in the repository.

---

## Module Map

| File | Purpose |
|---|---|
| `index.ts` | `PyrforRuntime` — main class wiring all subsystems |
| `config.ts` | `RuntimeConfigSchema`, `loadConfig`, `saveConfig`, `watchConfig`, env overrides |
| `health.ts` | `HealthMonitor` — pluggable async health checks with interval polling |
| `cron.ts` | `CronService` — croner-backed job scheduler with handler registry |
| `cron/handlers.ts` | Six built-in cron handler functions + `getDefaultHandlers()` |
| `gateway.ts` | `createRuntimeGateway` — zero-dependency HTTP server (Node `http`) |
| `session.ts` | `SessionManager` — in-memory sessions with token rollover |
| `session-store.ts` | `SessionStore` — atomic JSON file persistence for sessions |
| `voice.ts` | `transcribeTelegramVoice` — OpenAI Whisper API + local whisper-cli |
| `telegram/handlers.ts` | Pure PM command handlers (`/status`, `/projects`, `/tasks`, `/ai`, …) |
| `cli.ts` | CLI entry point: daemon / chat / telegram / once modes |
| `service.ts` | `createServiceManager` — macOS LaunchAgent + Linux systemd install/uninstall |
| `provider-router.ts` | `ProviderRouter` — smart AI provider selection with cost tracking and fallback |
| `tool-loop.ts` | `runToolLoop` — iterative tool-call execution loop |
| `tools.ts` | Runtime tool definitions and executor |
| `compact.ts` | `AutoCompact` — automatic message summarisation for long contexts |
| `subagents.ts` | `SubagentSpawner` — background task fork/join |
| `privacy.ts` | `PrivacyManager` — zone-based data isolation |
| `workspace-loader.ts` | `WorkspaceLoader` — loads SOUL.md / IDENTITY.md / MEMORY.md from disk |
| `telegram-types.ts` | `TelegramSender` interface (decouples runtime from grammY) |
