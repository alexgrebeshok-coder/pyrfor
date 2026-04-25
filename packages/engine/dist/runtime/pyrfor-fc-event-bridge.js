/**
 * pyrfor-fc-event-bridge.ts
 *
 * Translates typed FcEvents (from pyrfor-event-reader) into AcpEvents
 * (understood by step-validator / quality-gate).
 *
 * Two entry-points:
 *   - `fcEventToAcp`   — pure, 1-to-N mapping (may produce semantic duplicates)
 *   - `FcAcpBridge`    — stateful class that deduplicates using a ring buffer
 *                        of seen tool-use IDs
 */
// ── Helpers ───────────────────────────────────────────────────────────────────
function makeAcp(sessionId, type, data, ts) {
    return { sessionId, type, data, ts };
}
/**
 * Derive the ACP tool-kind from a FreeClaude tool name.
 *
 * Read/Glob/Grep       → 'read'
 * Edit/Write/MultiEdit/NotebookEdit → 'edit'
 * Bash                 → 'execute'
 * Task                 → 'other'
 * everything else      → 'other'
 */
function toolKindFromName(toolName) {
    switch (toolName.toLowerCase()) {
        case 'read':
        case 'glob':
        case 'grep':
            return 'read';
        case 'edit':
        case 'write':
        case 'multiedit':
        case 'notebookedit':
            return 'edit';
        case 'bash':
            return 'execute';
        default:
            return 'other';
    }
}
// ── Pure mapping ──────────────────────────────────────────────────────────────
/**
 * Translate a single FcEvent into 0-or-more AcpEvents.
 *
 * This function is **pure** (no internal state).  It may produce semantic
 * duplicates (e.g. a ToolCallStart for Bash AND a BashCommand for the same
 * action).  Use `FcAcpBridge` when you need deduplication.
 *
 * Mapping:
 *   Thinking              → agent_message_chunk  { text }
 *   ToolCallStart         → tool_call            { id, name, kind, args }
 *   ToolCallEnd           → tool_call_update     { id, name, output, isError }
 *   FileRead              → tool_call (kind:'read') { id, name:'Read', path }
 *   FileWrite             → diff                 { path, operation:'write' }
 *   FileEdit              → diff                 { path, operation:'edit' }
 *   FileDelete            → diff                 { path, operation:'delete' }
 *   BashCommand           → terminal             { command, id }
 *   TestRun               → terminal             { command, role:'test', passed, total }
 *   HookEvent             → agent_message_chunk  { hook, payload }
 *   CompilationError      → agent_message_chunk  { error }
 *   RuntimeError          → agent_message_chunk  { error }
 *   SessionStart/End      → []
 *   Unknown               → []
 */
export function fcEventToAcp(fc, opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const sid = opts.sessionId;
    switch (fc.type) {
        case 'Thinking':
            return [makeAcp(sid, 'agent_message_chunk', { text: fc.text }, fc.ts)];
        case 'ToolCallStart': {
            const kind = toolKindFromName(fc.toolName);
            return [
                makeAcp(sid, 'tool_call', { id: (_a = fc.toolUseId) !== null && _a !== void 0 ? _a : null, name: fc.toolName, kind, args: fc.input }, fc.ts),
            ];
        }
        case 'ToolCallEnd':
            return [
                makeAcp(sid, 'tool_call_update', {
                    id: (_b = fc.toolUseId) !== null && _b !== void 0 ? _b : null,
                    name: fc.toolName,
                    output: (_c = fc.output) !== null && _c !== void 0 ? _c : null,
                    isError: (_d = fc.isError) !== null && _d !== void 0 ? _d : false,
                }, fc.ts),
            ];
        case 'FileRead':
            return [
                makeAcp(sid, 'tool_call', { id: (_e = fc.toolUseId) !== null && _e !== void 0 ? _e : null, name: 'Read', kind: 'read', path: fc.path }, fc.ts),
            ];
        case 'FileWrite':
            return [makeAcp(sid, 'diff', { path: fc.path, operation: 'write' }, fc.ts)];
        case 'FileEdit':
            return [makeAcp(sid, 'diff', { path: fc.path, operation: 'edit' }, fc.ts)];
        case 'FileDelete':
            return [makeAcp(sid, 'diff', { path: fc.path, operation: 'delete' }, fc.ts)];
        case 'BashCommand':
            return [makeAcp(sid, 'terminal', { command: fc.command, id: (_f = fc.toolUseId) !== null && _f !== void 0 ? _f : null }, fc.ts)];
        case 'TestRun':
            return [
                makeAcp(sid, 'terminal', { command: fc.command, role: 'test', passed: (_g = fc.passed) !== null && _g !== void 0 ? _g : null, total: (_h = fc.total) !== null && _h !== void 0 ? _h : null }, fc.ts),
            ];
        case 'HookEvent':
            return [makeAcp(sid, 'agent_message_chunk', { hook: fc.hookName, payload: fc.payload }, fc.ts)];
        case 'CompilationError':
            return [makeAcp(sid, 'agent_message_chunk', { error: fc.message }, fc.ts)];
        case 'RuntimeError':
            return [makeAcp(sid, 'agent_message_chunk', { error: fc.message }, fc.ts)];
        case 'SessionStart':
        case 'SessionEnd':
        case 'Unknown':
        default:
            return [];
    }
}
/**
 * Bulk-translate an array of FcEvents (pure, may contain duplicates).
 */
export function fcEventsToAcp(fcs, opts) {
    return fcs.flatMap((fc) => fcEventToAcp(fc, opts));
}
// ── Stateful bridge with deduplication ───────────────────────────────────────
const RING_SIZE = 100;
/**
 * Stateful translator that eliminates semantic duplicates introduced when
 * FcEventReader emits both a ToolCallStart **and** a derived sugar event
 * (FileRead, BashCommand) for the same tool invocation.
 *
 * Dedup rules:
 *   • FileRead     — always skipped.  ToolCallStart with kind 'read' is the
 *                    canonical event; FileRead adds nothing new.
 *   • BashCommand  — skipped when its `toolUseId` matches a ToolCallStart
 *                    already seen in this session (ring buffer, last 100 ids).
 *   • FileWrite/FileEdit/FileDelete — always emitted as 'diff' events because
 *                    `extractTouchedPaths` relies on them.
 *   • All other events pass through unchanged.
 *
 * The ring buffer is not persisted across Bridge instances; create one Bridge
 * per FC session.
 */
export class FcAcpBridge {
    constructor(opts) {
        var _a;
        /** Ring buffer of tool-use IDs seen from ToolCallStart events. */
        this.seenToolIds = [];
        this.sessionId = opts.sessionId;
        this.now = (_a = opts.now) !== null && _a !== void 0 ? _a : (() => Date.now());
    }
    /**
     * Translate an array of FcEvents to deduplicated AcpEvents.
     */
    translate(fcs) {
        const bridgeOpts = { sessionId: this.sessionId, now: this.now };
        const result = [];
        for (const fc of fcs) {
            // Rule 1: Skip FileRead — ToolCallStart already emitted tool_call with kind 'read'.
            if (fc.type === 'FileRead')
                continue;
            // Rule 2: Track ToolCallStart tool IDs before emitting.
            if (fc.type === 'ToolCallStart') {
                if (fc.toolUseId) {
                    this.seenToolIds.push(fc.toolUseId);
                    if (this.seenToolIds.length > RING_SIZE) {
                        this.seenToolIds.shift();
                    }
                }
                result.push(...fcEventToAcp(fc, bridgeOpts));
                continue;
            }
            // Rule 3: Skip BashCommand when its toolUseId was already covered by ToolCallStart.
            if (fc.type === 'BashCommand') {
                if (fc.toolUseId && this.seenToolIds.includes(fc.toolUseId)) {
                    continue;
                }
                result.push(...fcEventToAcp(fc, bridgeOpts));
                continue;
            }
            // All other events (FileWrite, FileEdit, FileDelete, ToolCallEnd, Thinking, …) pass through.
            result.push(...fcEventToAcp(fc, bridgeOpts));
        }
        return result;
    }
}
