/**
 * Agent Heartbeat → Telegram notification bridge
 *
 * Sends formatted heartbeat run results to a Telegram chat.
 * Uses Telegram Bot API directly (no grammY dependency needed).
 *
 * Configure via:
 *   - TELEGRAM_BOT_TOKEN env var
 *   - Agent.runtimeConfig.telegramChatId for per-agent delivery
 */
interface HeartbeatNotification {
    agentName: string;
    runId: string;
    status: "succeeded" | "failed" | "timed_out";
    durationMs: number;
    tokenCount: number;
    costCents: number;
    summary: string | null;
    errorMessage?: string;
}
/**
 * Send heartbeat result notification to Telegram
 */
export declare function sendHeartbeatTelegramNotification(chatId: string | number, notification: HeartbeatNotification): Promise<boolean>;
/**
 * Send budget warning to Telegram
 */
export declare function sendBudgetWarningTelegram(chatId: string | number, agentName: string, spentCents: number, budgetCents: number): Promise<boolean>;
export {};
//# sourceMappingURL=telegram-notify.d.ts.map