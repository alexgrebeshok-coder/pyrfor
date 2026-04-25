/**
 * telegram-keyboards.ts — pure inline-keyboard helpers for grammY / Telegram Bot API.
 *
 * No runtime dependencies. All returned objects are plain-serialisable and match
 * the Telegram InlineKeyboardMarkup shape that grammY accepts directly.
 *
 * Telegram hard limits enforced here:
 *  • callback_data ≤ 64 bytes (UTF-8)
 *  • button text  ≤ 64 bytes  (safety truncation with ellipsis)
 */
export type InlineButton = {
    text: string;
    callback_data: string;
};
export type InlineKeyboard = {
    inline_keyboard: InlineButton[][];
};
export type CallbackKind = 'confirm' | 'choice' | 'page' | 'select' | 'cancel' | 'menu' | 'unknown';
export interface ParsedCallback {
    kind: CallbackKind;
    actionId: string;
    payload?: string;
}
export interface CallbackRouter {
    register(kind: CallbackKind, handler: (parsed: ParsedCallback, ctx?: unknown) => Promise<void> | void): void;
    handle(data: string, ctx?: unknown): Promise<boolean>;
}
export interface ConfirmOptions {
    yesText?: string;
    noText?: string;
}
/**
 * Returns a 1-row keyboard with [Yes, No] buttons.
 * callback_data: `confirm:yes:<actionId>` / `confirm:no:<actionId>`
 */
export declare function confirmKeyboard(actionId: string, opts?: ConfirmOptions): InlineKeyboard;
export interface ChoiceOptions {
    columns?: number;
}
/**
 * Returns a keyboard where each choice occupies one button.
 * Buttons are laid out in rows of `columns` (default 1).
 * callback_data: `choice:<actionId>:<index>`
 */
export declare function choiceKeyboard(actionId: string, choices: string[], opts?: ChoiceOptions): InlineKeyboard;
/**
 * Displays a page of items (one button per row) plus a navigation row.
 *
 * Navigation row:
 *  - [« prev]        → `page:<actionId>:prev`  (or `noop` when on first page)
 *  - [page n/total]  → `noop`
 *  - [next »]        → `page:<actionId>:next`  (or `noop` when on last page)
 *
 * Item buttons: `select:<actionId>:<item.id>`
 */
export declare function paginatedListKeyboard(items: {
    label: string;
    id: string;
}[], page: number, pageSize: number, actionId: string): InlineKeyboard;
/**
 * General-purpose menu keyboard. Items supply their own callback strings.
 * Buttons are arranged in rows of `columns` (default 1).
 */
export declare function menuKeyboard(items: {
    label: string;
    callback: string;
}[], columns?: number): InlineKeyboard;
/**
 * Single-button keyboard with a Cancel action.
 * callback_data: `cancel:<actionId>`
 */
export declare function cancelKeyboard(actionId: string): InlineKeyboard;
/**
 * Parses a Telegram callback_data string into a structured object.
 *
 * Supported prefixes (first segment):
 *  confirm  → payload = 'yes' | 'no'
 *  choice   → payload = index string
 *  page     → payload = 'prev' | 'next'
 *  select   → payload = item id
 *  cancel   → no payload
 *  menu     → payload = remainder
 *  unknown  → for anything else (incl. 'noop')
 */
export declare function parseCallback(data: string): ParsedCallback;
/**
 * Tiny dispatch table for inline keyboard callbacks.
 *
 * Usage:
 *   const router = createCallbackRouter();
 *   router.register('confirm', async (parsed, ctx) => { ... });
 *   const handled = await router.handle(callbackData, ctx);
 */
export declare function createCallbackRouter(): CallbackRouter;
//# sourceMappingURL=telegram-keyboards.d.ts.map