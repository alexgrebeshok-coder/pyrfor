/**
 * CEOClaw Daemon — Entry Point
 *
 * Starts the daemon gateway with all subsystems:
 * 1. Config loading + validation
 * 2. Prisma database connection
 * 3. Telegram bot (grammY, polling mode)
 * 4. Cron scheduler
 * 5. Health monitoring
 * 6. HTTP gateway server
 *
 * Usage:
 *   npx tsx daemon/index.ts                  # Run daemon
 *   npx tsx daemon/index.ts install          # Install as system service
 *   npx tsx daemon/index.ts uninstall        # Remove system service
 *   npx tsx daemon/index.ts status           # Check service status
 *
 * Architecture (from OpenClaw, improved):
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │              CEOClaw Daemon                      │
 *   │                                                  │
 *   │  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
 *   │  │ Telegram  │ │   Cron   │ │  AI Providers  │  │
 *   │  │ Bot       │ │ Service  │ │  Router        │  │
 *   │  │ (grammY)  │ │ (croner) │ │  (fallback)    │  │
 *   │  └─────┬─────┘ └────┬─────┘ └───────┬────────┘  │
 *   │        │             │               │           │
 *   │  ┌─────┴─────────────┴───────────────┴────────┐  │
 *   │  │         Gateway HTTP Server                 │  │
 *   │  │    /health /status /v1/chat/completions     │  │
 *   │  └─────────────────┬───────────────────────────┘  │
 *   │                    │                              │
 *   │  ┌─────────────────┴───────────────────────────┐  │
 *   │  │         Prisma (PostgreSQL / SQLite)         │  │
 *   │  └─────────────────────────────────────────────┘  │
 *   │                                                  │
 *   │  ┌────────────────┐ ┌──────────────────────────┐  │
 *   │  │ Health Monitor │ │   Config (ceoclaw.json)  │  │
 *   │  │ (subsystems)   │ │   + hot-reload           │  │
 *   │  └────────────────┘ └──────────────────────────┘  │
 *   └─────────────────────────────────────────────────┘
 *              ↕ HTTP API
 *   ┌─────────────────────────────────────────────────┐
 *   │       Next.js Web App (Vercel / local)          │
 *   │  openclaw-gateway.ts → daemon:18790             │
 *   └─────────────────────────────────────────────────┘
 */

import { PrismaClient } from "@prisma/client";
import { loadConfig, ConfigWatcher, getConfigPath } from "./config";
import { createLogger, setLogLevel } from "./logger";
import { HealthMonitor, type SubsystemName } from "./health";
import { createTelegramBot, startPolling, type TelegramBotOptions } from "./telegram/bot";
import { createHandlers, setPrismaClient } from "./telegram/handlers";
import { transcribeTelegramVoice } from "./telegram/voice";
import { CronService } from "./cron/service";
import { getDefaultHandlers, setCronPrismaClient } from "./cron/handlers";
import { createGatewayServer } from "./gateway";
import { createServiceManager, type ServiceOptions } from "./service";

const log = createLogger("daemon");

// ─── CLI Commands ──────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === "install" || command === "uninstall" || command === "status") {
  handleServiceCommand(command);
} else {
  startDaemon().catch((err) => {
    log.error("Fatal error", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}

// ─── Service Commands ──────────────────────────────────────────────────────

function handleServiceCommand(cmd: "install" | "uninstall" | "status") {
  const config = loadConfig();
  const manager = createServiceManager();

  switch (cmd) {
    case "install": {
      const options: ServiceOptions = {
        port: config.gateway.port,
      };
      manager.install(options);
      manager.start();
      console.log(`✅ CEOClaw daemon installed and started on port ${config.gateway.port}`);
      break;
    }
    case "uninstall":
      manager.uninstall();
      console.log("✅ CEOClaw daemon uninstalled");
      break;
    case "status": {
      const status = manager.status();
      console.log("CEOClaw Daemon Status:");
      console.log(`  Installed: ${status.installed ? "✅" : "❌"}`);
      console.log(`  Running:   ${status.running ? "✅" : "❌"}`);
      if (status.pid) console.log(`  PID:       ${status.pid}`);
      break;
    }
  }
  process.exit(0);
}

// ─── Main Daemon Startup ───────────────────────────────────────────────────

async function startDaemon() {
  log.info("CEOClaw Daemon starting...");

  // 1. Load config
  const config = loadConfig();
  const configWatcher = new ConfigWatcher(config);

  if (process.env.CEOCLAW_LOG_LEVEL) {
    setLogLevel(process.env.CEOCLAW_LOG_LEVEL as "debug" | "info" | "warn" | "error");
  }

  log.info("Config loaded", {
    port: config.gateway.port,
    telegram: config.telegram.token ? "configured" : "no token",
    cron: `${config.cron.jobs.length} jobs`,
  });

  // 2. Connect Prisma
  const prisma = new PrismaClient();
  await prisma.$connect();
  log.info("Database connected");

  // Share Prisma client with handlers
  setPrismaClient(prisma);
  setCronPrismaClient(prisma);

  // 3. Health Monitor
  const health = new HealthMonitor({
    intervalMs: config.health.intervalMs,
    restartOnFailure: config.health.restartOnFailure,
    maxRestarts: config.health.maxRestarts,
  });

  // Register database health check
  health.registerCheck("database", async () => ({
    name: "database",
    status: "healthy",
    lastCheck: new Date(),
    uptime: Date.now(),
    metadata: { provider: process.env.DATABASE_URL?.split(":")[0] ?? "unknown" },
  }));

  // 4. Cron Service
  const cron = new CronService();
  const cronHandlers = getDefaultHandlers();

  for (const [name, handler] of Object.entries(cronHandlers)) {
    cron.registerHandler(name, handler);
  }

  if (config.cron.enabled) {
    cron.start(config.cron.jobs);
  }

  health.registerCheck("cron", async () => ({
    name: "cron",
    status: cron.isRunning() ? "healthy" : "stopped",
    lastCheck: new Date(),
    uptime: Date.now(),
    metadata: { jobs: cron.getStatus().length },
  }));

  // 5. Telegram Bot
  let telegramRunner: ReturnType<typeof startPolling> | null = null;

  if (config.telegram.token && config.telegram.mode === "polling") {
    const handlers = createHandlers();

    const botOptions: TelegramBotOptions = {
      config: config.telegram,
      ...handlers,
      onAIQuery: async (_chatId, query) => {
        // Route to AI provider via the gateway's routing logic (includes tool calling)
        try {
          const response = await fetch(
            `http://127.0.0.1:${config.gateway.port}/v1/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(config.gateway.auth.token
                  ? { Authorization: `Bearer ${config.gateway.auth.token}` }
                  : {}),
              },
              body: JSON.stringify({
                model: config.ai.defaultModel ?? "gpt-4o-mini",
                messages: [{ role: "user", content: query }],
              }),
            }
          );

          if (!response.ok) throw new Error(`AI request failed: ${response.status}`);

          const data = (await response.json()) as {
            choices: Array<{ message: { content: string } }>;
            toolResults?: Array<{ name: string; success: boolean; displayMessage: string }>;
          };

          const content = data.choices[0]?.message?.content ?? "Нет ответа от AI";

          // If tools were executed, indicate that in the response
          if (data.toolResults && data.toolResults.length > 0) {
            const toolSummary = data.toolResults
              .filter((r) => r.success)
              .map((r) => r.name)
              .join(", ");
            if (toolSummary) {
              log.info("AI executed tools via Telegram", { tools: toolSummary, chatId: _chatId });
            }
          }

          return content;
        } catch (err) {
          log.error("AI query failed", { error: String(err) });
          return `❌ AI недоступен: ${err instanceof Error ? err.message : "Unknown error"}`;
        }
      },
      onVoiceMessage: async (_chatId, fileId) => {
        if (!config.telegram.token) throw new Error("No bot token");

        const result = await transcribeTelegramVoice(
          config.telegram.token,
          fileId,
          config.voice
        );

        if (!result.text.trim()) {
          return "🎤 Не удалось распознать речь. Попробуйте ещё раз.";
        }

        // Process recognized text as AI query
        const aiResponse = await botOptions.onAIQuery(_chatId, result.text);
        return `🎤 Распознано: _"${result.text}"_\n\n${aiResponse}`;
      },
    };

    const bot = createTelegramBot(botOptions);

    if (bot) {
      telegramRunner = startPolling(bot);
      telegramRunner.start();

      health.registerCheck("telegram", async () => ({
        name: "telegram",
        status: telegramRunner?.isRunning() ? "healthy" : "unhealthy",
        lastCheck: new Date(),
        uptime: Date.now(),
      }));
    }
  } else {
    log.info("Telegram bot disabled", {
      reason: !config.telegram.token ? "no token" : "webhook mode (use Next.js handler)",
    });
  }

  // 6. Gateway HTTP Server
  const gateway = createGatewayServer({
    config,
    health,
    cron,
    telegramRunner,
  });

  await gateway.start();

  health.registerCheck("gateway", async () => ({
    name: "gateway",
    status: "healthy",
    lastCheck: new Date(),
    uptime: Date.now(),
    metadata: { port: config.gateway.port },
  }));

  // 7. Start health monitoring
  health.start();

  // 8. Config hot-reload
  configWatcher.onChange((newConfig, oldConfig) => {
    log.info("Config reloaded");

    // Update cron jobs if changed
    if (JSON.stringify(newConfig.cron) !== JSON.stringify(oldConfig.cron)) {
      cron.stop();
      if (newConfig.cron.enabled) {
        cron.start(newConfig.cron.jobs);
      }
    }
  });
  configWatcher.start();

  // 9. Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Shutdown signal received: ${signal}`);

    configWatcher.stop();
    health.stop();
    cron.stop();

    if (telegramRunner) {
      await telegramRunner.stop();
    }

    await gateway.stop();
    await prisma.$disconnect();

    log.info("CEOClaw Daemon stopped gracefully");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // 10. Ready!
  log.info("═══════════════════════════════════════════════════");
  log.info("  CEOClaw Daemon is running");
  log.info(`  Gateway:  http://127.0.0.1:${config.gateway.port}`);
  log.info(`  Health:   http://127.0.0.1:${config.gateway.port}/health`);
  log.info(`  Telegram: ${telegramRunner ? "✅ polling" : "❌ disabled"}`);
  log.info(`  Cron:     ${cron.isRunning() ? `✅ ${cron.getStatus().length} jobs` : "❌ disabled"}`);
  log.info("═══════════════════════════════════════════════════");
}
