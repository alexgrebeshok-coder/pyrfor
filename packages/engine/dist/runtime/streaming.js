/**
 * Streaming chat layer.
 *
 * `handleMessageStream` is an async generator that drives the existing
 * `runToolLoop` and emits structured events as they occur:
 *
 *   {type:'run', sessionId, runId, taskId} — emitted once when a runtime run starts
 *   {type:'token', text}         — one event per LLM response (full turn text)
 *   {type:'tool', name, args}    — emitted before each tool execution
 *   {type:'tool_result', name, result} — emitted after each tool execution
 *   {type:'final', text, usage?} — always last; text = stripped final answer
 *
 * Since our AI providers return `Promise<string>` (no native streaming),
 * each LLM turn produces exactly one `token` event carrying the full text of
 * that turn.  True character-by-character streaming can be wired in later by
 * replacing the `chat` function with one that chunks its output.
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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import { runToolLoop } from './tool-loop.js';
// ─── Context-file helpers ──────────────────────────────────────────────────
const OPEN_FILES_HARD_CAP = 64 * 1024; // 64 KB combined
/**
 * Builds a `<context_files>` XML block from the supplied open files.
 * Truncates combined content at 64 KB (in path order) and appends a marker.
 */
export function buildContextBlock(openFiles) {
    var _a;
    let total = 0;
    const parts = [];
    let truncated = false;
    for (const f of openFiles) {
        if (total + f.content.length > OPEN_FILES_HARD_CAP) {
            truncated = true;
            break;
        }
        total += f.content.length;
        const lang = (_a = f.language) !== null && _a !== void 0 ? _a : '';
        parts.push(`<file path="${f.path}" lang="${lang}">${f.content}</file>`);
    }
    const inner = parts.join('\n') + (truncated ? '\n… [truncated]' : '');
    return `<context_files>\n${inner}\n</context_files>`;
}
// ─── Core generator ────────────────────────────────────────────────────────
/**
 * Async generator that streams events from a tool-loop run.
 *
 * @param messages  Full conversation history including the new user message.
 * @param options   Chat function, exec function, tools, …
 */
export function handleMessageStream(messages, options) {
    return __asyncGenerator(this, arguments, function* handleMessageStream_1() {
        var _a, _b, _c, _d;
        const queue = [];
        let notify = () => { };
        const push = (item) => {
            queue.push(item);
            notify();
        };
        // ── Wrap chat to emit token events ────────────────────────────────────
        const wrappedChat = (msgs, opts) => __awaiter(this, void 0, void 0, function* () {
            const text = yield options.chat(msgs, opts);
            push({ type: 'token', text });
            return text;
        });
        // ── Wrap exec to emit tool / tool_result events ───────────────────────
        const noopExec = () => __awaiter(this, void 0, void 0, function* () { return ({ success: true, data: {} }); });
        const execFn = (_a = options.exec) !== null && _a !== void 0 ? _a : noopExec;
        const wrappedExec = (name, args, ctx) => __awaiter(this, void 0, void 0, function* () {
            push({ type: 'tool', name, args });
            const result = yield execFn(name, args, ctx);
            push({ type: 'tool_result', name, result: result.data });
            return result;
        });
        // ── Start the loop (fire-and-forget, we drain the queue below) ────────
        const loopPromise = runToolLoop(messages, (_b = options.tools) !== null && _b !== void 0 ? _b : [], wrappedChat, wrappedExec, options.toolCtx, (_c = options.runOpts) !== null && _c !== void 0 ? _c : {}, (_d = options.loopOpts) !== null && _d !== void 0 ? _d : {})
            .then((result) => {
            push({ type: 'final', text: result.finalText });
            push(null); // sentinel
        })
            .catch((err) => {
            push(err instanceof Error ? err : new Error(String(err)));
            push(null); // sentinel
        });
        // ── Drain queue ───────────────────────────────────────────────────────
        while (true) {
            if (queue.length === 0) {
                yield __await(new Promise((r) => {
                    notify = r;
                }));
            }
            const item = queue.shift();
            if (item === null)
                break;
            if (item instanceof Error)
                throw item;
            yield yield __await(item);
        }
        // Ensure the loop promise is settled (re-throws if it rejected and we
        // somehow missed the error sentinel, which shouldn't happen in practice).
        yield __await(loopPromise);
    });
}
