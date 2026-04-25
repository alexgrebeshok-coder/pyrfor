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
import type { FcEvent } from './pyrfor-event-reader';
import type { AcpEvent } from './acp-client';
export interface BridgeOptions {
    sessionId: string;
    now?: () => number;
}
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
export declare function fcEventToAcp(fc: FcEvent, opts: BridgeOptions): AcpEvent[];
/**
 * Bulk-translate an array of FcEvents (pure, may contain duplicates).
 */
export declare function fcEventsToAcp(fcs: FcEvent[], opts: BridgeOptions): AcpEvent[];
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
export declare class FcAcpBridge {
    private readonly sessionId;
    private readonly now;
    /** Ring buffer of tool-use IDs seen from ToolCallStart events. */
    private readonly seenToolIds;
    constructor(opts: BridgeOptions);
    /**
     * Translate an array of FcEvents to deduplicated AcpEvents.
     */
    translate(fcs: FcEvent[]): AcpEvent[];
}
//# sourceMappingURL=pyrfor-fc-event-bridge.d.ts.map