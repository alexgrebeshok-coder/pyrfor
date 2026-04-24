/**
 * Telegram callback-query dispatcher — grammY-agnostic.
 *
 * Usage:
 *   const router = createCallbackRouter();
 *   router.on('status', async (action, ctx) => { ... });
 *   await router.dispatch(ctx.callbackQuery.data, ctx);
 */

import { logger } from '../../observability/logger';
import { parseCallback } from './inline';

// ─── Types ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallbackHandler = (action: string, ctx: any) => Promise<void> | void;

export interface CallbackRouter {
  /** Register a handler for a callback namespace. */
  on(namespace: string, handler: CallbackHandler): void;
  /**
   * Parse `data` and dispatch to the matching handler.
   * Returns `{ handled: true }` when a handler was invoked,
   * `{ handled: false }` when the namespace is unknown or data is malformed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch(data: string, ctx: any): Promise<{ handled: boolean }>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCallbackRouter(): CallbackRouter {
  const handlers = new Map<string, CallbackHandler>();

  return {
    on(namespace: string, handler: CallbackHandler): void {
      handlers.set(namespace, handler);
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async dispatch(data: string, ctx: any): Promise<{ handled: boolean }> {
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
      await handler(action, ctx);
      return { handled: true };
    },
  };
}
