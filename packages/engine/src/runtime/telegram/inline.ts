/**
 * Telegram inline-keyboard builders — grammY-agnostic.
 *
 * Returns plain JSON-shaped objects that match the Telegram Bot API
 * `InlineKeyboardMarkup` shape. No grammy import; safe for any context.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ParsedCallback {
  namespace: string;
  action: string;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

/**
 * Help command keyboard — quick-access buttons for common commands.
 */
export function buildHelpKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📊 Status', callback_data: 'help:status' },
        { text: '📋 Tasks', callback_data: 'help:tasks' },
      ],
      [
        { text: '📂 Projects', callback_data: 'help:projects' },
        { text: '☀️ Brief', callback_data: 'help:brief' },
      ],
      [
        { text: '🗑 Clear history', callback_data: 'help:clear' },
      ],
    ],
  };
}

/**
 * Status command keyboard.
 * The leading emoji on the first button reflects current health.
 */
export function buildStatusKeyboard(opts: { healthy: boolean }): InlineKeyboardMarkup {
  const refreshEmoji = opts.healthy ? '🔄' : '⚠️';
  return {
    inline_keyboard: [
      [
        { text: `${refreshEmoji} Refresh`, callback_data: 'status:refresh' },
        { text: '📊 Metrics', callback_data: 'status:metrics' },
      ],
      [
        { text: '🩺 Run Checks', callback_data: 'status:check' },
      ],
    ],
  };
}

/**
 * Clear-history confirmation keyboard.
 */
export function buildClearConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Yes, clear', callback_data: 'clear:yes' },
        { text: '❌ Cancel', callback_data: 'clear:no' },
      ],
    ],
  };
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a callback_data string in `<namespace>:<action>` format.
 * Returns null for malformed data (missing colon, empty parts).
 */
export function parseCallback(data: string): ParsedCallback | null {
  if (!data || typeof data !== 'string') return null;

  const colonIndex = data.indexOf(':');
  if (colonIndex === -1) return null;

  const namespace = data.slice(0, colonIndex);
  const action = data.slice(colonIndex + 1);

  if (!namespace || !action) return null;

  return { namespace, action };
}
