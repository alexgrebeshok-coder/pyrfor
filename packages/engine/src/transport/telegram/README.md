# Telegram Bot Integration

This module provides Telegram bot integration for CEOClaw project management.

## Setup

### 1. Create a Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` command
3. Follow the prompts:
   - Enter bot name (e.g., "CEOClaw Bot")
   - Enter bot username (must end with `bot`, e.g., `ceoclaw_bot`)
4. BotFather will provide a **token** like:
   ```
   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
   Save this token!

### 2. Configure Environment

Add the token to your environment:

**For local development (`.env.local`):**
```env
TELEGRAM_BOT_TOKEN="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
```

**For Vercel deployment:**
1. Go to your Vercel project dashboard
2. Settings → Environment Variables
3. Add `TELEGRAM_BOT_TOKEN` with your token

### 3. Register Webhook (Production)

After deploying to Vercel, register the webhook:

```bash
# Using curl
curl -X POST "https://your-app.vercel.app/api/telegram/setup"

# Or with custom URL
curl -X POST "https://your-app.vercel.app/api/telegram/setup?url=https://your-app.vercel.app"
```

**Response:**
```json
{
  "ok": true,
  "webhook_url": "https://your-app.vercel.app/api/telegram/webhook",
  "telegram_response": {
    "ok": true,
    "result": true,
    "description": "Webhook was set"
  }
}
```

### 4. Check Webhook Status

```bash
curl "https://your-app.vercel.app/api/telegram/setup"
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and introduction |
| `/help` | List of available commands |
| `/status` | System status and health check |
| `/projects` | List all projects |
| `/tasks` | List all tasks |
| `/add_task [project] [task]` | Create a new task |
| `/ai [prompt]` | AI-powered assistance |

## Architecture

```
lib/telegram/
├── bot.ts              # Main bot initialization (polling mode)
├── commands/           # Command handlers
│   ├── start.ts        # /start command
│   ├── help.ts         # /help command
│   ├── status.ts       # /status command
│   ├── projects.ts     # /projects command
│   ├── tasks.ts        # /tasks command
│   ├── add-task.ts     # /add_task command
│   └── ai.ts           # /ai command
└── README.md           # This file

app/api/telegram/
├── webhook/
│   └── route.ts        # Webhook endpoint (production)
└── setup/
    └── route.ts        # Webhook registration endpoint
```

## Development vs Production

### Development (Polling)
- Uses `lib/telegram/bot.ts` with polling mode
- Bot automatically starts when `TELEGRAM_BOT_TOKEN` is set
- No webhook setup needed

### Production (Webhook)
- Uses `app/api/telegram/webhook/route.ts`
- Must register webhook via `/api/telegram/setup`
- More efficient for serverless environments (Vercel)

## Security Notes

1. **Never commit tokens** to git
2. Use environment variables
3. Validate incoming webhooks (Telegram provides `X-Telegram-Bot-Api-Secret-Token`)
4. Rate limit commands if needed

## Troubleshooting

### Bot not responding
1. Check `TELEGRAM_BOT_TOKEN` is set
2. Verify webhook is registered: `GET /api/telegram/setup`
3. Check Vercel logs for errors

### Webhook registration fails
1. Ensure bot token is valid
2. Check URL is HTTPS (required by Telegram)
3. Verify endpoint is accessible publicly

### Commands not working
1. Check command format (e.g., `/add_task project-name task description`)
2. Review logs in `lib/logger`
3. Test individual command handlers

## Resources

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [BotFather](https://t.me/botfather)
- [Webhooks Guide](https://core.telegram.org/bots/webhooks)
