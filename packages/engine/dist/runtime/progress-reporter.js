// @vitest-environment node
/**
 * TG progress reporter — reusable "no silent waiting" helper.
 *
 * Streams status messages to a Telegram chat with edit-message debouncing
 * and graceful failure so pipeline errors never surface to the user.
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
function isRateLimit(err) {
    return (typeof err === 'object' &&
        err !== null &&
        err.error_code === 429);
}
// ─── Implementation ───────────────────────────────────────────────────────────
export function createProgressReporter(opts) {
    const { api, chatId, replyTo, editDebounceMs = 1500, typingIntervalMs = 4000, maxLength = 3500, log, now = Date.now, } = opts;
    let _state = 'idle';
    let _messageId;
    /** Text that was last successfully sent/edited to TG. */
    let _lastSentText = '';
    /** Pending debounce timer id. */
    let _debounceTimer;
    /** Text queued for the next debounced edit. */
    let _pendingText;
    /** Typing interval id. */
    let _typingInterval;
    /** Timestamp of the last completed editMessageText call. */
    let _lastEditAt = 0;
    /** Serialisation queue — prevents overlapping editMessageText calls. */
    let _queue = Promise.resolve();
    // ── helpers ────────────────────────────────────────────────────────────────
    function truncate(text) {
        if (maxLength <= 0)
            return '…';
        if (text.length <= maxLength)
            return text;
        return text.slice(0, maxLength - 1) + '…';
    }
    function isDone() {
        return _state === 'finished' || _state === 'failed' || _state === 'cancelled';
    }
    function stopTyping() {
        if (_typingInterval !== undefined) {
            clearInterval(_typingInterval);
            _typingInterval = undefined;
        }
    }
    function clearDebounce() {
        if (_debounceTimer !== undefined) {
            clearTimeout(_debounceTimer);
            _debounceTimer = undefined;
            _pendingText = undefined;
        }
    }
    function callWithRetry(fn) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                return yield fn();
            }
            catch (err) {
                if (isRateLimit(err)) {
                    const waitSec = (_b = (_a = err.parameters) === null || _a === void 0 ? void 0 : _a.retry_after) !== null && _b !== void 0 ? _b : 1;
                    log === null || log === void 0 ? void 0 : log('progress-reporter: rate limited, retrying', { retry_after: waitSec });
                    yield new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                    try {
                        return yield fn();
                    }
                    catch (err2) {
                        log === null || log === void 0 ? void 0 : log('progress-reporter: retry failed', { error: String(err2) });
                        return undefined;
                    }
                }
                log === null || log === void 0 ? void 0 : log('progress-reporter: api error (swallowed)', { error: String(err) });
                return undefined;
            }
        });
    }
    function startTypingLoop() {
        if (typingIntervalMs <= 0)
            return;
        // Fire immediately, then repeat.
        void callWithRetry(() => api.sendChatAction(chatId, 'typing'));
        _typingInterval = setInterval(() => {
            void callWithRetry(() => api.sendChatAction(chatId, 'typing'));
        }, typingIntervalMs);
    }
    // ── core operations (all serialised through _queue) ────────────────────────
    function enqueue(task) {
        _queue = _queue.then(task).catch(() => {
            // Should never happen — task catches its own errors — but safety net.
        });
    }
    function doSend(text, parseMode) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield callWithRetry(() => api.sendMessage(chatId, truncate(text), Object.assign(Object.assign({}, (parseMode ? { parse_mode: parseMode } : {})), (replyTo !== undefined ? { reply_to_message_id: replyTo } : {}))));
            if (result) {
                _messageId = result.message_id;
                _lastSentText = truncate(text);
                log === null || log === void 0 ? void 0 : log('progress-reporter: sendMessage ok', { messageId: _messageId });
            }
        });
    }
    function doEdit(text, parseMode) {
        return __awaiter(this, void 0, void 0, function* () {
            if (_messageId === undefined)
                return;
            const truncated = truncate(text);
            if (truncated === _lastSentText)
                return; // skip no-op edit
            yield callWithRetry(() => api.editMessageText(chatId, _messageId, truncated, Object.assign({}, (parseMode ? { parse_mode: parseMode } : {}))));
            _lastSentText = truncated;
            _lastEditAt = now();
            log === null || log === void 0 ? void 0 : log('progress-reporter: editMessageText ok', { messageId: _messageId });
        });
    }
    // ── public API ─────────────────────────────────────────────────────────────
    function start(initialText) {
        return __awaiter(this, void 0, void 0, function* () {
            if (_state !== 'idle')
                return; // idempotent
            _state = 'sent';
            enqueue(() => doSend(initialText));
            startTypingLoop();
        });
    }
    function update(text) {
        return __awaiter(this, void 0, void 0, function* () {
            if (isDone())
                return;
            if (_state === 'idle') {
                yield start(text);
                return;
            }
            // Clear existing debounce timer; re-schedule with latest text.
            clearDebounce();
            _pendingText = text;
            const elapsed = now() - _lastEditAt;
            const delay = Math.max(0, editDebounceMs - elapsed);
            _debounceTimer = setTimeout(() => {
                _debounceTimer = undefined;
                const toSend = _pendingText;
                _pendingText = undefined;
                enqueue(() => doEdit(toSend));
            }, delay);
        });
    }
    function finish(finalText, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            if (isDone())
                return;
            stopTyping();
            clearDebounce();
            const mode = opts === null || opts === void 0 ? void 0 : opts.parseMode;
            if (_state === 'idle') {
                _state = 'finished';
                enqueue(() => doSend(finalText, mode));
            }
            else {
                _state = 'finished';
                enqueue(() => doEdit(finalText, mode));
            }
            // Await the queue so caller can rely on message being sent when awaiting finish().
            yield _queue;
        });
    }
    function fail(reason) {
        return __awaiter(this, void 0, void 0, function* () {
            if (isDone())
                return;
            stopTyping();
            clearDebounce();
            const prefixed = `❌ ${reason}`;
            if (_state === 'idle') {
                _state = 'failed';
                enqueue(() => doSend(prefixed));
            }
            else {
                _state = 'failed';
                enqueue(() => doEdit(prefixed));
            }
            yield _queue;
        });
    }
    function cancel() {
        return __awaiter(this, void 0, void 0, function* () {
            if (isDone())
                return;
            stopTyping();
            clearDebounce();
            _state = 'cancelled';
        });
    }
    return {
        start,
        update,
        finish,
        fail,
        cancel,
        get messageId() { return _messageId; },
        get state() { return _state; },
    };
}
