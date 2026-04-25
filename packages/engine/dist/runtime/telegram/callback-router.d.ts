/**
 * Telegram callback-query dispatcher — grammY-agnostic.
 *
 * Usage:
 *   const router = createCallbackRouter();
 *   router.on('status', async (action, ctx) => { ... });
 *   await router.dispatch(ctx.callbackQuery.data, ctx);
 */
export type CallbackHandler = (action: string, ctx: any) => Promise<void> | void;
export interface CallbackRouter {
    /** Register a handler for a callback namespace. */
    on(namespace: string, handler: CallbackHandler): void;
    /**
     * Parse `data` and dispatch to the matching handler.
     * Returns `{ handled: true }` when a handler was invoked,
     * `{ handled: false }` when the namespace is unknown or data is malformed.
     */
    dispatch(data: string, ctx: any): Promise<{
        handled: boolean;
    }>;
}
export declare function createCallbackRouter(): CallbackRouter;
//# sourceMappingURL=callback-router.d.ts.map