// @vitest-environment node
/**
 * TG progress reporter — reusable "no silent waiting" helper.
 *
 * Streams status messages to a Telegram chat with edit-message debouncing
 * and graceful failure so pipeline errors never surface to the user.
 */

/**
 * Minimal subset of grammY ChatApi we depend on. Tests can mock this trivially;
 * cli.ts will pass `bot.api` (compatible-shaped) at runtime.
 */
export interface ChatProgressApi {
  sendMessage(
    chatId: number | string,
    text: string,
    opts?: { parse_mode?: string; reply_to_message_id?: number },
  ): Promise<{ message_id: number }>;
  editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    opts?: { parse_mode?: string },
  ): Promise<unknown>;
  sendChatAction(
    chatId: number | string,
    action: 'typing' | 'upload_document' | 'upload_photo',
  ): Promise<unknown>;
  deleteMessage?(chatId: number | string, messageId: number): Promise<unknown>;
}

export interface ProgressReporterOptions {
  api: ChatProgressApi;
  chatId: number | string;
  /** Optional reply-to message id for the initial sendMessage. */
  replyTo?: number;
  /** Min ms between editMessageText calls. Default 1500. */
  editDebounceMs?: number;
  /** Auto-typing-action interval (set to 0 to disable). Default 4000. */
  typingIntervalMs?: number;
  /** Max characters for any single message; truncated with "…" suffix. Default 3500. */
  maxLength?: number;
  /** Optional logger. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  /** Inject Date.now for tests. */
  now?: () => number;
}

export interface ProgressReporter {
  /** Send the initial status message. Idempotent: subsequent calls are ignored. */
  start(initialText: string): Promise<void>;
  /** Edit the existing message (debounced). If start() not called yet, calls it. */
  update(text: string): Promise<void>;
  /** Final message text. Cancels pending debounced updates. Stops typing. */
  finish(finalText: string, opts?: { parseMode?: string }): Promise<void>;
  /** Mark as error; keeps message visible with ❌ prefix. */
  fail(reason: string): Promise<void>;
  /** Cancel without sending finish. Stops typing. */
  cancel(): Promise<void>;
  /** Status accessors for tests/inspection. */
  readonly messageId: number | undefined;
  readonly state: 'idle' | 'sent' | 'finished' | 'failed' | 'cancelled';
}

// ─── Rate-limit error shape from Telegram ────────────────────────────────────

interface TgRateLimitError {
  error_code: number;
  parameters?: { retry_after?: number };
}

function isRateLimit(err: unknown): err is TgRateLimitError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as TgRateLimitError).error_code === 429
  );
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function createProgressReporter(opts: ProgressReporterOptions): ProgressReporter {
  const {
    api,
    chatId,
    replyTo,
    editDebounceMs = 1500,
    typingIntervalMs = 4000,
    maxLength = 3500,
    log,
    now = Date.now,
  } = opts;

  let _state: ProgressReporter['state'] = 'idle';
  let _messageId: number | undefined;

  /** Text that was last successfully sent/edited to TG. */
  let _lastSentText = '';

  /** Pending debounce timer id. */
  let _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Text queued for the next debounced edit. */
  let _pendingText: string | undefined;

  /** Typing interval id. */
  let _typingInterval: ReturnType<typeof setInterval> | undefined;

  /** Timestamp of the last completed editMessageText call. */
  let _lastEditAt = 0;

  /** Serialisation queue — prevents overlapping editMessageText calls. */
  let _queue: Promise<void> = Promise.resolve();

  // ── helpers ────────────────────────────────────────────────────────────────

  function truncate(text: string): string {
    if (maxLength <= 0) return '…';
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
  }

  function isDone(): boolean {
    return _state === 'finished' || _state === 'failed' || _state === 'cancelled';
  }

  function stopTyping(): void {
    if (_typingInterval !== undefined) {
      clearInterval(_typingInterval);
      _typingInterval = undefined;
    }
  }

  function clearDebounce(): void {
    if (_debounceTimer !== undefined) {
      clearTimeout(_debounceTimer);
      _debounceTimer = undefined;
      _pendingText = undefined;
    }
  }

  async function callWithRetry<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      if (isRateLimit(err)) {
        const waitSec = err.parameters?.retry_after ?? 1;
        log?.('progress-reporter: rate limited, retrying', { retry_after: waitSec });
        await new Promise<void>(resolve => setTimeout(resolve, waitSec * 1000));
        try {
          return await fn();
        } catch (err2) {
          log?.('progress-reporter: retry failed', { error: String(err2) });
          return undefined;
        }
      }
      log?.('progress-reporter: api error (swallowed)', { error: String(err) });
      return undefined;
    }
  }

  function startTypingLoop(): void {
    if (typingIntervalMs <= 0) return;
    // Fire immediately, then repeat.
    void callWithRetry(() => api.sendChatAction(chatId, 'typing'));
    _typingInterval = setInterval(() => {
      void callWithRetry(() => api.sendChatAction(chatId, 'typing'));
    }, typingIntervalMs);
  }

  // ── core operations (all serialised through _queue) ────────────────────────

  function enqueue(task: () => Promise<void>): void {
    _queue = _queue.then(task).catch(() => {
      // Should never happen — task catches its own errors — but safety net.
    });
  }

  async function doSend(text: string, parseMode?: string): Promise<void> {
    const result = await callWithRetry(() =>
      api.sendMessage(chatId, truncate(text), {
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
      }),
    );
    if (result) {
      _messageId = result.message_id;
      _lastSentText = truncate(text);
      log?.('progress-reporter: sendMessage ok', { messageId: _messageId });
    }
  }

  async function doEdit(text: string, parseMode?: string): Promise<void> {
    if (_messageId === undefined) return;
    const truncated = truncate(text);
    if (truncated === _lastSentText) return; // skip no-op edit
    await callWithRetry(() =>
      api.editMessageText(chatId, _messageId!, truncated, {
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    );
    _lastSentText = truncated;
    _lastEditAt = now();
    log?.('progress-reporter: editMessageText ok', { messageId: _messageId });
  }

  // ── public API ─────────────────────────────────────────────────────────────

  async function start(initialText: string): Promise<void> {
    if (_state !== 'idle') return; // idempotent
    _state = 'sent';
    enqueue(() => doSend(initialText));
    startTypingLoop();
  }

  async function update(text: string): Promise<void> {
    if (isDone()) return;

    if (_state === 'idle') {
      await start(text);
      return;
    }

    // Clear existing debounce timer; re-schedule with latest text.
    clearDebounce();
    _pendingText = text;

    const elapsed = now() - _lastEditAt;
    const delay = Math.max(0, editDebounceMs - elapsed);

    _debounceTimer = setTimeout(() => {
      _debounceTimer = undefined;
      const toSend = _pendingText!;
      _pendingText = undefined;
      enqueue(() => doEdit(toSend));
    }, delay);
  }

  async function finish(finalText: string, opts?: { parseMode?: string }): Promise<void> {
    if (isDone()) return;

    stopTyping();
    clearDebounce();

    const mode = opts?.parseMode;

    if (_state === 'idle') {
      _state = 'finished';
      enqueue(() => doSend(finalText, mode));
    } else {
      _state = 'finished';
      enqueue(() => doEdit(finalText, mode));
    }

    // Await the queue so caller can rely on message being sent when awaiting finish().
    await _queue;
  }

  async function fail(reason: string): Promise<void> {
    if (isDone()) return;

    stopTyping();
    clearDebounce();

    const prefixed = `❌ ${reason}`;

    if (_state === 'idle') {
      _state = 'failed';
      enqueue(() => doSend(prefixed));
    } else {
      _state = 'failed';
      enqueue(() => doEdit(prefixed));
    }

    await _queue;
  }

  async function cancel(): Promise<void> {
    if (isDone()) return;
    stopTyping();
    clearDebounce();
    _state = 'cancelled';
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
