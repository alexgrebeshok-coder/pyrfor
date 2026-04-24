# Changelog — Pyrfor Runtime

> **Project:** `@ceoclaw/engine` — Pyrfor Runtime
>
> Pyrfor Runtime is the packaged, library-grade successor to the legacy **CEOClaw daemon**
> (`daemon/` at the repo root). It wires together a Telegram bot, an OpenAI-compatible HTTP
> gateway, a cron scheduler, a health monitor, and persistent session management — all driven
> by a single JSON config file. It can be embedded as a Node.js library, launched from the
> command line, or installed as a macOS LaunchAgent / Linux systemd user service.
>
> See [`packages/engine/docs/MIGRATION-FROM-DAEMON.md`](docs/MIGRATION-FROM-DAEMON.md) for
> the planned removal of `daemon/`.

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses **Unreleased** until the first tagged release is cut.

---

## [Unreleased]

### Added

#### Runtime core
- `src/runtime/index.ts` — `PyrforRuntime` class: top-level orchestrator that wires all
  sub-systems (config, health, cron, gateway, Telegram, hot-reload) and exposes a clean
  `start()` / `stop()` lifecycle (TASK-10/11/12).
- `src/runtime/config.ts` — `RuntimeConfig` module: Zod-validated JSON schema for
  `~/.pyrfor/runtime.json`; file-watcher-based hot-reload without process restart (TASK-01).
- `src/runtime/session.ts` — `Session` type and per-session message history helpers used
  across the tool loop.
- `src/runtime/session-store.ts` — `SessionStore`: atomic JSON file persistence for sessions
  under `~/.pyrfor/sessions/`; survives restarts.
- `src/runtime/provider-router.ts` — provider-agnostic AI router with automatic fallback
  across configured LLM providers.
- `src/runtime/tool-loop.ts` — multi-turn tool-calling loop; parses both standard
  `tool_calls` arrays and GLM `<tool_call={json}>` inline shapes.
- `src/runtime/tools.ts` — built-in tool definitions (web search, file I/O, workspace
  operations).
- `src/runtime/subagents.ts` — sub-agent spawning helpers for delegating tasks to child
  runtime instances.
- `src/runtime/workspace-loader.ts` — resolves and validates the active workspace directory
  (`~/.openclaw/workspace` default).
- `src/runtime/compact.ts` — auto-compact strategy: summarises old messages when a session
  exceeds ~70 % of the token budget.
- `src/runtime/privacy.ts` — privacy-zone system; each tool/action is tagged with an
  isolation level to prevent data leakage across contexts.

#### HTTP Gateway
- `src/runtime/gateway.ts` — HTTP gateway server exposing an OpenAI-compatible `/v1/chat`
  endpoint, `/health`, and `/metrics`; bearer-token auth; configurable port (TASK-06).
- `src/runtime/gateway.test.ts` — unit tests for gateway routing and auth middleware.
- `src/runtime/openapi.yaml` — OpenAPI 3.1 specification for the runtime HTTP gateway,
  covering all routes, request/response schemas, and security definitions.

#### Telegram
- `src/runtime/telegram/handlers.ts` — grammY middleware chain: `/start`, `/help`,
  `/status`, `/tasks`, `/projects`, `add_task` PM handler, AI query dispatch, ACL
  enforcement (TASK-07).
- `src/runtime/telegram/handlers.test.ts` — unit tests for Telegram handlers.
- `src/runtime/telegram-types.ts` — shared TypeScript types for Telegram session state and
  handler options.

#### Cron
- `src/runtime/cron.ts` — `CronService`: typed cron scheduler built on `croner`; runs
  registered handlers on CRON expressions; execution-history tracking (TASK-03).
- `src/runtime/cron/handlers.ts` — concrete cron handlers: agent heartbeat (TASK-05),
  morning brief, task/project digests, and custom user-defined jobs (TASK-04).
- `src/runtime/cron.test.ts` — unit tests for `CronService`.
- `src/runtime/cron/handlers.test.ts` — unit tests for individual cron handlers.

#### Health
- `src/runtime/health.ts` — `HealthMonitor`: tracks subsystem liveness (Telegram, cron,
  gateway, Prisma), exposes `/health` JSON endpoint, configurable failure thresholds
  (TASK-02).
- `src/runtime/health.test.ts` — unit tests for `HealthMonitor`.

#### Voice
- `src/runtime/voice.ts` — voice transcription module: downloads Telegram voice OGG,
  converts via `ffmpeg`, transcribes with local `whisper-cli`; Whisper language is
  configurable (TASK-08).
- `src/runtime/voice.test.ts` — unit tests for voice transcription pipeline.

#### OS Service
- `src/runtime/service.ts` — OS service manager: installs/removes the runtime as a macOS
  LaunchAgent (`dev.pyrfor.runtime.plist`) or Linux systemd user unit
  (`pyrfor-runtime.service`); async-first, ESM-native (TASK-09).
- `src/runtime/service.test.ts` — unit tests for service manager (macOS + Linux paths).

#### Sessions / Migration
- `src/runtime/migrate-sessions.ts` — `migrateSessionsToPyrfor()`: scans legacy
  `~/.openclaw/sessions/*.sqlite|*.db` and `~/.ceoclaw/sessions/**/*.json` stores and
  imports them into `~/.pyrfor/sessions/` format; dry-run mode supported.
- `src/runtime/migrate-sessions.test.ts` — unit tests for session migration.

#### Observability
- `src/runtime/metrics.ts` — hand-written Prometheus text-format exposition (no external
  libs): exposes runtime uptime, cron job counts, health-check states, session counts.
- `src/runtime/metrics.test.ts` — unit tests for metrics serialisation.
- `src/observability/logger.ts` — structured logger (rebranded from `daemon/logger.ts`),
  shared across all packages in the monorepo.

#### Prisma adapter
- `src/runtime/prisma-adapter.ts` — optional Prisma integration for cron handlers and
  Telegram handlers; keeps the runtime usable without a database when Prisma is absent.
- `src/runtime/prisma-adapter.test.ts` — unit tests for Prisma adapter.

#### Tooling
- `scripts/install.sh` — one-button installer: detects platform, checks Node ≥ 20 / pnpm,
  creates `~/.pyrfor/`, generates `runtime.json`, optionally registers background service;
  supports `--non-interactive` flag.
- `scripts/uninstall.sh` — removes the LaunchAgent / systemd unit and optionally wipes
  `~/.pyrfor/`.
- `Dockerfile` + `docker-compose.yml` — containerised Pyrfor runtime image based on
  `node:20-alpine`; mounts config and session volumes.
- `src/runtime/cli.ts` — `pyrfor-runtime` CLI entry point: `--chat` (interactive),
  `--telegram`, `--once "<question>"`, and `service install|uninstall|status` sub-commands.
- `src/runtime/runtime.e2e.test.ts` — end-to-end integration test for `PyrforRuntime`
  (cold start → health check → graceful stop).
- `.github/workflows/engine-runtime.yml` — CI workflow: install, build, lint, test for the
  `packages/engine` workspace.

#### Docs
- `src/runtime/README.md` — comprehensive user-facing README: overview, installation,
  manual setup, configuration schema reference, CLI usage, service management, Docker,
  contributing notes.
- `docs/MIGRATION-FROM-DAEMON.md` — daemon deletion migration plan (this release cycle).

---

### Changed

- **Telegram library:** replaced `node-telegram-bot-api` (unmaintained, event-handler
  leak on webhook restarts) with **grammY** + `@grammyjs/runner`; proper middleware chain,
  sequentialisation per chat, update deduplication, rate-limiting transformer.
- **Entry point:** `daemon/index.ts` (direct `ts-node` script) replaced by the
  `PyrforRuntime` class in `src/runtime/index.ts` with a clean async lifecycle; the CLI
  wrapper in `src/runtime/cli.ts` provides the same sub-commands (`install`, `uninstall`,
  `status`) plus new modes (`--chat`, `--once`).
- **Config path:** runtime config moved from project-local `daemon.config.json` to
  `~/.pyrfor/runtime.json` (user-scoped, permissions 0700); backward-compatible env
  override via `PYRFOR_CONFIG`.
- **Logger:** `daemon/logger.ts` (`createLogger`) relocated to
  `src/observability/logger.ts` and re-exported as `logger`; now shared monorepo-wide.
- **Service plist/unit label:** LaunchAgent domain changed from `com.ceoclaw.daemon` to
  `dev.pyrfor.runtime`.

---

### Removed

- Nothing removed yet. `daemon/` remains in the repository for the 30-day parallel-run
  period. See [`docs/MIGRATION-FROM-DAEMON.md`](docs/MIGRATION-FROM-DAEMON.md) for the
  planned cutover and deletion timeline.

---

<!-- Links -->
[Unreleased]: https://github.com/<owner>/<repo>/compare/HEAD...HEAD
