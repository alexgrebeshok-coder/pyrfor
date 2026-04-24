# Migration: `node-telegram-bot-api` → `grammY` (runtime)

**Status:** done · **Scope:** `packages/engine/src/runtime/` only · **Date:** 2026-04-24

## Why

`node-telegram-bot-api` is unmaintained (last release 2023, no TS-native
types, no middleware model). The standalone `daemon/` already runs on
**grammY** (see `daemon/telegram/bot.ts`); this brings the runtime in
line so we have one Telegram stack.

## What changed

| File                              | Change                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `runtime/telegram-types.ts` *(new)* | Defines `TelegramSender` interface — minimal `sendMessage(chatId, text, opts?)` API.                |
| `runtime/tools.ts`                | `setTelegramBot(bot)` now accepts `TelegramSender` instead of `node-telegram-bot-api` `TelegramBot`. |
| `runtime/index.ts`                | `PyrforRuntime.setTelegramBot(bot)` retyped to `TelegramSender`. New `clearSession()` method.        |
| `runtime/cli.ts`                  | `runTelegram()` rewritten with `grammy` + `@grammyjs/runner`.                                         |

## New runtime features

- **Update deduplication** (200-entry sliding window) — survives polling restarts
- **Per-chat sequencing** via `@grammyjs/runner`'s `sequentialize()`
- **Per-chat rate limit** 1 msg/sec (memory-based)
- **Voice messages** → OpenAI Whisper (graceful fallback if `OPENAI_API_KEY` unset)
- **Commands:** `/start /help /status /stats /clear`
- **Long-message split** at 4000 chars with Markdown→plain fallback
- **Graceful shutdown** via runner's `stop()` on `SIGINT`/`SIGTERM`

## Run it

```bash
cd packages/engine
export TELEGRAM_BOT_TOKEN=<your-bot-token>      # from @BotFather
export OPENAI_API_KEY=<optional, for voice>

# from source (no compile step)
npx tsx src/runtime/cli.ts --telegram

# or via the built CLI
npm run build
node dist/runtime/cli.js --telegram
```

## Tools API note

`runtime/tools.ts → sendMessage('telegram', ...)` is unchanged externally.
Internally it now calls `TelegramSender.sendMessage()`, which the CLI
adapter forwards to `bot.api.sendMessage()` (grammY) with automatic
Markdown→plain fallback.

## Removed

- All `import('node-telegram-bot-api')` usage from `runtime/`
- `bot.stopPolling()` / `bot.onText()` patterns

The `node-telegram-bot-api` dependency may still be referenced elsewhere
(e.g. legacy `daemon/` was already on grammY). If nothing else imports
it, remove it from the package's dependencies.
