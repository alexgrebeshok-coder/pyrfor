/**
 * Telegram inline-keyboard builders — grammY-agnostic.
 *
 * Returns plain JSON-shaped objects that match the Telegram Bot API
 * `InlineKeyboardMarkup` shape. No grammy import; safe for any context.
 */
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
/**
 * Help command keyboard — quick-access buttons for common commands.
 */
export declare function buildHelpKeyboard(): InlineKeyboardMarkup;
/**
 * Status command keyboard.
 * The leading emoji on the first button reflects current health.
 */
export declare function buildStatusKeyboard(opts: {
    healthy: boolean;
}): InlineKeyboardMarkup;
/**
 * Clear-history confirmation keyboard.
 */
export declare function buildClearConfirmKeyboard(): InlineKeyboardMarkup;
/**
 * Parse a callback_data string in `<namespace>:<action>` format.
 * Returns null for malformed data (missing colon, empty parts).
 */
export declare function parseCallback(data: string): ParsedCallback | null;
//# sourceMappingURL=inline.d.ts.map