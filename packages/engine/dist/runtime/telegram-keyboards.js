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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ─── Internal byte helpers ────────────────────────────────────────────────────
const ELLIPSIS = '\u2026'; // "…" — 3 UTF-8 bytes
function byteLen(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80)
            n += 1;
        else if (c < 0x800)
            n += 2;
        else if (c < 0xd800 || c > 0xdfff)
            n += 3;
        else {
            n += 2;
            i++;
        } // surrogate pair → 4 bytes total, counted over two iterations
    }
    return n;
}
/** Truncate a string so its UTF-8 encoding fits within maxBytes. */
function truncateBytes(s, maxBytes) {
    if (byteLen(s) <= maxBytes)
        return s;
    const ellBytes = byteLen(ELLIPSIS); // 3
    const budget = maxBytes - ellBytes;
    let acc = 0;
    let cut = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        let w;
        if (c < 0x80)
            w = 1;
        else if (c < 0x800)
            w = 2;
        else if (c < 0xd800 || c > 0xdfff)
            w = 3;
        else {
            w = 2;
        } // first half of surrogate pair (4 bytes across two chars, skip second below)
        if (acc + w > budget)
            break;
        acc += w;
        cut = i + 1;
    }
    return s.slice(0, cut) + ELLIPSIS;
}
/** Clamp label to 64 bytes with ellipsis. */
function safeLabel(text) {
    return truncateBytes(text, 64);
}
/** Clamp callback_data to 64 bytes (hard Telegram limit). */
function safeCb(data) {
    return truncateBytes(data, 64);
}
/** Chunk an array into rows of at most `size` elements. */
function chunkArray(arr, size) {
    const rows = [];
    for (let i = 0; i < arr.length; i += size) {
        rows.push(arr.slice(i, i + size));
    }
    return rows;
}
/**
 * Returns a 1-row keyboard with [Yes, No] buttons.
 * callback_data: `confirm:yes:<actionId>` / `confirm:no:<actionId>`
 */
export function confirmKeyboard(actionId, opts = {}) {
    const { yesText = 'Yes', noText = 'No' } = opts;
    return {
        inline_keyboard: [
            [
                { text: safeLabel(yesText), callback_data: safeCb(`confirm:yes:${actionId}`) },
                { text: safeLabel(noText), callback_data: safeCb(`confirm:no:${actionId}`) },
            ],
        ],
    };
}
/**
 * Returns a keyboard where each choice occupies one button.
 * Buttons are laid out in rows of `columns` (default 1).
 * callback_data: `choice:<actionId>:<index>`
 */
export function choiceKeyboard(actionId, choices, opts = {}) {
    var _a;
    const columns = Math.max(1, (_a = opts.columns) !== null && _a !== void 0 ? _a : 1);
    const buttons = choices.map((label, idx) => ({
        text: safeLabel(label),
        callback_data: safeCb(`choice:${actionId}:${idx}`),
    }));
    return { inline_keyboard: chunkArray(buttons, columns) };
}
// ─── paginatedListKeyboard ────────────────────────────────────────────────────
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
export function paginatedListKeyboard(items, page, pageSize, actionId) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = items.slice(safePage * pageSize, safePage * pageSize + pageSize);
    const itemRows = slice.map((item) => [
        {
            text: safeLabel(item.label),
            callback_data: safeCb(`select:${actionId}:${item.id}`),
        },
    ]);
    const prevCb = safePage > 0 ? safeCb(`page:${actionId}:prev`) : 'noop';
    const nextCb = safePage < totalPages - 1 ? safeCb(`page:${actionId}:next`) : 'noop';
    const navRow = [
        { text: '«', callback_data: prevCb },
        { text: `${safePage + 1}/${totalPages}`, callback_data: 'noop' },
        { text: '»', callback_data: nextCb },
    ];
    return { inline_keyboard: [...itemRows, navRow] };
}
// ─── menuKeyboard ─────────────────────────────────────────────────────────────
/**
 * General-purpose menu keyboard. Items supply their own callback strings.
 * Buttons are arranged in rows of `columns` (default 1).
 */
export function menuKeyboard(items, columns = 1) {
    const cols = Math.max(1, columns);
    const buttons = items.map((item) => ({
        text: safeLabel(item.label),
        callback_data: safeCb(item.callback),
    }));
    return { inline_keyboard: chunkArray(buttons, cols) };
}
// ─── cancelKeyboard ───────────────────────────────────────────────────────────
/**
 * Single-button keyboard with a Cancel action.
 * callback_data: `cancel:<actionId>`
 */
export function cancelKeyboard(actionId) {
    return {
        inline_keyboard: [
            [{ text: 'Cancel', callback_data: safeCb(`cancel:${actionId}`) }],
        ],
    };
}
// ─── parseCallback ────────────────────────────────────────────────────────────
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
export function parseCallback(data) {
    if (!data || data === 'noop') {
        return { kind: 'unknown', actionId: '', payload: data || undefined };
    }
    const [prefix, ...rest] = data.split(':');
    switch (prefix) {
        case 'confirm': {
            // confirm:yes:<actionId>  or  confirm:no:<actionId>
            const [dir, ...idParts] = rest;
            return { kind: 'confirm', actionId: idParts.join(':'), payload: dir };
        }
        case 'choice': {
            // choice:<actionId>:<idx>
            const [actionId, ...payParts] = rest;
            return { kind: 'choice', actionId, payload: payParts.join(':') };
        }
        case 'page': {
            // page:<actionId>:prev|next
            const [actionId, ...payParts] = rest;
            return { kind: 'page', actionId, payload: payParts.join(':') };
        }
        case 'select': {
            // select:<actionId>:<id>  (id may contain colons)
            const [actionId, ...payParts] = rest;
            return { kind: 'select', actionId, payload: payParts.join(':') };
        }
        case 'cancel': {
            return { kind: 'cancel', actionId: rest.join(':') };
        }
        case 'menu': {
            // menu:<actionId>:<payload>
            const [actionId, ...payParts] = rest;
            return { kind: 'menu', actionId, payload: payParts.join(':') };
        }
        default:
            return { kind: 'unknown', actionId: '', payload: data };
    }
}
/**
 * Tiny dispatch table for inline keyboard callbacks.
 *
 * Usage:
 *   const router = createCallbackRouter();
 *   router.register('confirm', async (parsed, ctx) => { ... });
 *   const handled = await router.handle(callbackData, ctx);
 */
export function createCallbackRouter() {
    const handlers = new Map();
    return {
        register(kind, handler) {
            handlers.set(kind, handler);
        },
        handle(data, ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                const parsed = parseCallback(data);
                const handler = handlers.get(parsed.kind);
                if (!handler)
                    return false;
                try {
                    yield handler(parsed, ctx);
                    return true;
                }
                catch (err) {
                    console.warn(`[telegram-keyboards] router handler for "${parsed.kind}" threw:`, err);
                    return false;
                }
            });
        },
    };
}
