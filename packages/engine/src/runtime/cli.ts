#!/usr/bin/env node
/**
 * Pyrfor Runtime CLI — Entry point
 *
 * Usage:
 *   node dist/runtime/cli.js              # Start runtime
 *   node dist/runtime/cli.js --chat       # Interactive CLI mode
 *   node dist/runtime/cli.js --telegram   # Telegram bot mode
 *   node dist/runtime/cli.js --once "question"  # One-shot question
 */

import { createInterface } from 'readline';
import { PyrforRuntime } from './index';
import { logger } from '../observability/logger';

// ============================================
// CLI Types
// ============================================

type CLIMode = 'daemon' | 'chat' | 'telegram' | 'once';

interface CLIOptions {
  mode: CLIMode;
  message?: string;
  workspacePath?: string;
  provider?: string;
  model?: string;
  help: boolean;
}

// ============================================
// Argument Parser
// ============================================

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);

  const options: CLIOptions = {
    mode: 'daemon',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;

      case '--chat':
        options.mode = 'chat';
        break;

      case '--telegram':
        options.mode = 'telegram';
        break;

      case '--once':
        options.mode = 'once';
        options.message = args[++i];
        break;

      case '--workspace':
      case '-w':
        options.workspacePath = args[++i];
        break;

      case '--provider':
      case '-p':
        options.provider = args[++i];
        break;

      case '--model':
      case '-m':
        options.model = args[++i];
        break;
    }
  }

  return options;
}

function showHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
Pyrfor Runtime — Standalone AI Assistant Engine

Usage:
  pyrfor-runtime [options]

Options:
  --chat              Interactive CLI mode
  --telegram          Telegram bot mode
  --once "question"   One-shot question and exit
  --workspace, -w     Workspace path (default: current directory)
  --provider, -p      Default AI provider (zai, openrouter, ollama)
  --model, -m         Model to use
  --help, -h          Show this help

Environment Variables:
  ZAI_API_KEY         API key for ZAI provider
  OPENROUTER_API_KEY  API key for OpenRouter
  OPENAI_API_KEY      API key for OpenAI
  TELEGRAM_BOT_TOKEN  Bot token for Telegram mode
  OLLAMA_URL          URL for Ollama (default: http://localhost:11434)
  LOG_LEVEL           Set to debug, info, warn, error, or silent

Examples:
  # Interactive chat
  npm run cli -- --chat

  # One-shot question
  npm run cli -- --once "What is TypeScript?"

  # Telegram bot
  npm run cli -- --telegram
`);
}

// ============================================
// Mode Handlers
// ============================================

/**
 * Daemon mode — just start and keep running
 */
async function runDaemon(runtime: PyrforRuntime): Promise<void> {
  logger.info('Running in daemon mode');

  // Runtime is already started, just keep alive
  // Could add health check server here

  // Keep process alive
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await runtime.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    await runtime.stop();
    process.exit(0);
  });

  // Keep running indefinitely
  return new Promise(() => {
    setInterval(() => {
      const stats = runtime.getStats();
      logger.debug('Heartbeat', {
        sessions: stats.sessions.active,
        tokens: stats.sessions.totalTokens,
      });
    }, 60000); // Log stats every minute
  });
}

/**
 * Interactive chat mode
 */
async function runChat(runtime: PyrforRuntime, options: CLIOptions): Promise<void> {
  logger.info('Running in interactive chat mode');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const userId = 'cli-user';
  const chatId = 'cli-chat';

  // eslint-disable-next-line no-console
  console.log('\n🤖 Pyrfor Runtime — Interactive Mode');
  // eslint-disable-next-line no-console
  console.log('Type your message or "exit" to quit.\n');

  const askQuestion = (): void => {
    rl.question('You: ', async (input) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        rl.close();
        await runtime.stop();
        process.exit(0);
      }

      if (input.toLowerCase() === 'stats') {
        const stats = runtime.getStats();
        // eslint-disable-next-line no-console
        console.log('\n📊 Stats:', JSON.stringify(stats, null, 2), '\n');
        askQuestion();
        return;
      }

      if (input.toLowerCase() === 'clear') {
        // eslint-disable-next-line no-console
        console.clear();
        askQuestion();
        return;
      }

      if (!input.trim()) {
        askQuestion();
        return;
      }

      // Process message
      const result = await runtime.handleMessage('cli', userId, chatId, input, {
        provider: options.provider,
        model: options.model,
      });

      if (result.success) {
        // eslint-disable-next-line no-console
        console.log(`\n🤖: ${result.response}`);
        if (result.costUsd && result.costUsd > 0) {
          // eslint-disable-next-line no-console
          console.log(`   💰 $${result.costUsd.toFixed(6)}`);
        }
        // eslint-disable-next-line no-console
        console.log();
      } else {
        // eslint-disable-next-line no-console
        console.error(`\n❌ Error: ${result.error}\n`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Telegram bot mode
 */
async function runTelegram(runtime: PyrforRuntime): Promise<void> {
  logger.info('Running in Telegram bot mode');

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN not set');
    // eslint-disable-next-line no-console
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required for Telegram mode');
    process.exit(1);
  }

  // Import Telegram bot dynamically to avoid requiring it if not used
  let TelegramBotModule: unknown;
  try {
    TelegramBotModule = await import('node-telegram-bot-api');
  } catch {
    logger.error('node-telegram-bot-api not installed');
    // eslint-disable-next-line no-console
    console.error('Error: node-telegram-bot-api is required. Install with: npm install node-telegram-bot-api');
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TelegramBot = (TelegramBotModule as any).default || TelegramBotModule as any;
  const bot: import('node-telegram-bot-api') = new TelegramBot(token, { polling: true });
  runtime.setTelegramBot(bot);

  logger.info('Telegram bot started');

  // Handle /start command
  bot.onText(/\/start/, (msg: import('node-telegram-bot-api').Message) => {
    bot.sendMessage(
      msg.chat.id,
      '👋 Hello! I am Pyrfor, your AI assistant.\n\nJust send me a message and I\'ll help you out!'
    );
  });

  // Handle /help command
  bot.onText(/\/help/, (msg: import('node-telegram-bot-api').Message) => {
    bot.sendMessage(
      msg.chat.id,
      `🤖 *Pyrfor Commands*

Just type your message - I'll respond with AI.

Commands:
/start - Start conversation
/help - Show this help
/status - Show runtime stats

I can also use tools - just ask!`,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle /status command
  bot.onText(/\/status/, async (msg: import('node-telegram-bot-api').Message) => {
    const stats = runtime.getStats();
    const statusText = `📊 *Runtime Status*

Sessions: ${stats.sessions.active}
Total tokens: ${stats.sessions.totalTokens}
Available providers: ${stats.providers.available.join(', ') || 'none'}
Total cost: $${stats.providers.costs.totalUsd.toFixed(4)}`;
    bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
  });

  // Handle all text messages
  bot.on('message', async (msg: import('node-telegram-bot-api').Message) => {
    // Skip commands
    if (msg.text?.startsWith('/')) return;
    if (!msg.text) return;

    const chatId = String(msg.chat.id);
    const userId = String(msg.from?.id || 'unknown');
    const text = msg.text;

    // Show typing indicator
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    // Process message
    const result = await runtime.handleMessage('telegram', userId, chatId, text);

    if (result.success) {
      // Split long messages for Telegram (4096 char limit)
      const maxLength = 4000;
      let response = result.response;

      while (response.length > 0) {
        const chunk = response.slice(0, maxLength);
        response = response.slice(maxLength);

        try {
          await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        } catch {
          // If Markdown fails, send as plain text
          await bot.sendMessage(chatId, chunk);
        }
      }
    } else {
      bot.sendMessage(chatId, `❌ Error: ${result.error}`);
    }
  });

  // Handle errors
  bot.on('polling_error', (error: Error) => {
    logger.error('Telegram polling error', { error: String(error) });
  });

  // Keep alive
  process.on('SIGINT', async () => {
    logger.info('Shutting down Telegram bot...');
    bot.stopPolling();
    await runtime.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down Telegram bot...');
    bot.stopPolling();
    await runtime.stop();
    process.exit(0);
  });

  // Keep running
  return new Promise(() => {});
}

/**
 * One-shot mode
 */
async function runOnce(runtime: PyrforRuntime, options: CLIOptions): Promise<void> {
  const message = options.message;
  if (!message) {
    // eslint-disable-next-line no-console
    console.error('Error: Message required. Use --once "your question"');
    process.exit(1);
  }

  logger.info('Running in one-shot mode', { message: message.slice(0, 100) });

  const result = await runtime.handleMessage('cli', 'cli-user', 'cli-chat', message, {
    provider: options.provider,
    model: options.model,
  });

  if (result.success) {
    // eslint-disable-next-line no-console
    console.log(result.response);
    if (result.costUsd && result.costUsd > 0) {
      // eslint-disable-next-line no-console
      console.error(`\n[Cost: $${result.costUsd.toFixed(6)}]`);
    }
  } else {
    // eslint-disable-next-line no-console
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  await runtime.stop();
  process.exit(0);
}

// ============================================
// Main Entry Point
// ============================================

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Create and start runtime
  const runtime = new PyrforRuntime({
    workspacePath: options.workspacePath,
    providerOptions: {
      defaultProvider: options.provider,
    },
  });

  await runtime.start();

  const stats = runtime.getStats();
  logger.info('Runtime started', {
    workspace: stats.workspace.loaded,
    availableProviders: stats.providers.available,
  });

  // Run in selected mode
  switch (options.mode) {
    case 'daemon':
      await runDaemon(runtime);
      break;

    case 'chat':
      await runChat(runtime, options);
      break;

    case 'telegram':
      await runTelegram(runtime);
      break;

    case 'once':
      await runOnce(runtime, options);
      break;
  }
}

// Run main
main().catch((error) => {
  logger.error('Fatal error', { error: String(error) });
  // eslint-disable-next-line no-console
  console.error('Fatal error:', error);
  process.exit(1);
});
