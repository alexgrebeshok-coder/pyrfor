/**
 * pyrfor-fc-control.ts
 *
 * Mid-task control for FreeClaude sessions: abort, resume, and prompt injection.
 */

import { runFreeClaude } from './pyrfor-fc-adapter';
import type { FCRunOptions, FCEnvelope, FCEvent, FCHandle } from './pyrfor-fc-adapter';

export interface SessionRecord {
  sessionId: string;
  taskId?: string;
  endedAt: number;
  envelope: FCEnvelope;
  abortReason?: string;
}

export interface FcControllerOptions {
  /** Adapter spawner for testability. Default: runFreeClaude from pyrfor-fc-adapter. */
  runFn?: (opts: FCRunOptions) => FCHandle;
  /** Clock. */
  now?: () => number;
  /** Logger. */
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}

export interface InjectionPlan {
  /**
   * Correction text appended to FC's system prompt on resume.
   * Will be passed via --append-system-prompt.
   */
  correction: string;
  /**
   * Optional new model to switch to on resume.
   */
  model?: string;
  /**
   * Optional max-turns override for the resumed call.
   */
  maxTurns?: number;
  /**
   * Reason logged to controller.history.
   */
  reason: string;
}

export interface RunningSession {
  sessionId?: string; // populated once we observe a session_id from events
  taskId?: string;
  baseOptions: FCRunOptions;
  handle: FCHandle;
  startedAt: number;
}

export interface FcController {
  /**
   * Start a new FC session. Captures handle internally.
   * Returns the running session token (used to abort/inject).
   */
  start(opts: FCRunOptions, taskId?: string): RunningSession;

  /**
   * Wait for the running session to complete; returns envelope. Records into history.
   */
  await(running: RunningSession): Promise<FCEnvelope>;

  /**
   * Abort the running session (SIGTERM via FCHandle.abort), record reason.
   * Returns the (error) envelope from FCHandle.complete().
   */
  abort(running: RunningSession, reason: string): Promise<FCEnvelope>;

  /**
   * Mid-task injection:
   *   1. abort() the running session, capturing its sessionId.
   *   2. resume with the same baseOptions but with correction applied.
   *   3. return the new RunningSession.
   */
  inject(
    running: RunningSession,
    plan: InjectionPlan,
    opts?: { continuationPrompt?: string },
  ): Promise<RunningSession>;

  /**
   * Resume a previously-ended session by id. Useful after error recovery.
   */
  resumeFromHistory(
    sessionId: string,
    prompt: string,
    overrides?: Partial<FCRunOptions>,
  ): RunningSession;

  /** All completed sessions (success/error/aborted). */
  history(): SessionRecord[];
}

// Internal extension to track the background reader promise
interface InternalRunningSession extends RunningSession {
  _readerDone: Promise<void>;
}

function extractSessionIdFromEvent(ev: FCEvent): string | undefined {
  const raw = (ev as any).raw;
  if (typeof raw?.sessionId === 'string' && raw.sessionId) return raw.sessionId;
  if (typeof raw?.session_id === 'string' && raw.session_id) return raw.session_id;

  if (ev.type === 'result') {
    const result = (ev as any).result;
    if (typeof result?.sessionId === 'string' && result.sessionId) return result.sessionId;
    if (typeof result?.session_id === 'string' && result.session_id) return result.session_id;
  }

  return undefined;
}

export function createFcController(ctrlOpts?: FcControllerOptions): FcController {
  const runFn = ctrlOpts?.runFn ?? runFreeClaude;
  const nowFn = ctrlOpts?.now ?? (() => Date.now());
  const log =
    ctrlOpts?.logger ??
    ((_level: string, _msg: string, _meta?: any) => {
      /* no-op */
    });

  const _history: SessionRecord[] = [];

  function start(opts: FCRunOptions, taskId?: string): RunningSession {
    const handle = runFn(opts);

    const running: InternalRunningSession = {
      sessionId: undefined,
      taskId,
      baseOptions: opts,
      handle,
      startedAt: nowFn(),
      _readerDone: Promise.resolve(), // placeholder, replaced below
    };

    // Background events reader — non-blocking, captures sessionId
    running._readerDone = (async () => {
      try {
        for await (const ev of handle.events()) {
          if (!running.sessionId) {
            const id = extractSessionIdFromEvent(ev);
            if (id) {
              running.sessionId = id;
              log('info', 'sessionId captured', { sessionId: id });
            }
          }
        }
      } catch (err) {
        log('info', 'background events reader ended early', { err });
      }
    })();

    return running;
  }

  async function awaitSession(running: RunningSession): Promise<FCEnvelope> {
    const internal = running as InternalRunningSession;
    const [result] = await Promise.all([running.handle.complete(), internal._readerDone]);
    const { envelope } = result;

    _history.push({
      sessionId: running.sessionId ?? envelope.sessionId ?? '',
      taskId: running.taskId,
      endedAt: nowFn(),
      envelope,
    });

    return envelope;
  }

  async function abortSession(running: RunningSession, reason: string): Promise<FCEnvelope> {
    const internal = running as InternalRunningSession;
    running.handle.abort(reason);

    const [result] = await Promise.all([running.handle.complete(), internal._readerDone]);
    const { envelope } = result;

    _history.push({
      sessionId: running.sessionId ?? envelope.sessionId ?? '',
      taskId: running.taskId,
      endedAt: nowFn(),
      envelope,
      abortReason: reason,
    });

    return envelope;
  }

  async function inject(
    running: RunningSession,
    plan: InjectionPlan,
    opts?: { continuationPrompt?: string },
  ): Promise<RunningSession> {
    const envelope = await abortSession(running, plan.reason);

    const sessionId = envelope.sessionId ?? running.sessionId;
    if (!sessionId) {
      throw new Error('cannot inject: no session id captured yet');
    }

    const baseAppend = running.baseOptions.appendSystemPrompt ?? '';
    const correctionBlock = `[CORRECTION]\n${plan.correction}`;
    const newAppend = baseAppend ? `${baseAppend}\n\n${correctionBlock}` : correctionBlock;

    const newOpts: FCRunOptions = {
      ...running.baseOptions,
      resume: sessionId,
      appendSystemPrompt: newAppend,
      prompt: opts?.continuationPrompt ?? 'Continue with the corrections above.',
      ...(plan.model !== undefined ? { model: plan.model } : {}),
      ...(plan.maxTurns !== undefined ? { maxTurns: plan.maxTurns } : {}),
    };

    return start(newOpts, running.taskId);
  }

  function resumeFromHistory(
    sessionId: string,
    prompt: string,
    overrides?: Partial<FCRunOptions>,
  ): RunningSession {
    const newOpts = {
      ...(overrides ?? {}),
      resume: sessionId,
      prompt,
    } as FCRunOptions;

    return start(newOpts);
  }

  return {
    start,
    await: awaitSession,
    abort: abortSession,
    inject,
    resumeFromHistory,
    history: () => _history,
  };
}
