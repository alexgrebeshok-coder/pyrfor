/**
 * Telegram callback-query dispatcher — grammY-agnostic.
 *
 * Usage:
 *   const router = createCallbackRouter();
 *   router.on('status', async (action, ctx) => { ... });
 *   await router.dispatch(ctx.callbackQuery.data, ctx);
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
import { logger } from '../../observability/logger.js';
import { parseCallback } from './inline.js';
// ─── Factory ──────────────────────────────────────────────────────────────────
export function createCallbackRouter() {
    const handlers = new Map();
    return {
        on(namespace, handler) {
            handlers.set(namespace, handler);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dispatch(data, ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                const parsed = parseCallback(data);
                if (!parsed) {
                    logger.warn('[telegram] callback-router: malformed callback data', { data });
                    return { handled: false };
                }
                const { namespace, action } = parsed;
                const handler = handlers.get(namespace);
                if (!handler) {
                    logger.debug('[telegram] callback-router: no handler for namespace', { namespace, action });
                    return { handled: false };
                }
                logger.debug('[telegram] callback-router: dispatching', { namespace, action });
                yield handler(action, ctx);
                return { handled: true };
            });
        },
    };
}
