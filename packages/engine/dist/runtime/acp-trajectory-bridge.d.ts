/**
 * acp-trajectory-bridge.ts — Phase H1→G+1 bridge.
 *
 * Wires every supervised ACP coding session into a TrajectoryRecord so the
 * pattern miner and reflector can analyse real agent behaviour.
 *
 * Constraints: ESM, pure TS, no native deps beyond Node built-ins.
 */
import type { AcpEvent, AcpStopReason, AcpSession } from './acp-client.js';
import type { ToolCallTrace } from './trajectory.js';
import type { GateDecision } from './quality-gate.js';
import type { ValidatorResult } from './step-validator.js';
/**
 * ToolCallRecord extends ToolCallTrace with an optional `kind` field used
 * to tag synthetic bridge entries (e.g. 'edit', 'execute').
 */
export type ToolCallRecord = ToolCallTrace & {
    kind?: string;
};
/**
 * Minimal recorder interface.  Compatible with the builder returned by
 * TrajectoryRecorder.begin() as well as test-double objects that have a
 * direct `finish` method.
 */
export interface BridgeRecorder {
    finish(record: {
        sessionId: string;
        success: boolean;
        finalAnswer: string;
        stopReason?: string;
        tokensUsed?: number;
        costUsd?: number;
        toolCalls?: ToolCallRecord[];
        metadata?: Record<string, unknown>;
    }): Promise<unknown> | unknown;
}
export interface AcpTrajectoryBridgeOptions {
    /** Compatible with TrajectoryBuilder or test mocks that expose finish(). */
    recorder: BridgeRecorder;
    /** ACP session id — used as the trajectory key. */
    sessionId: string;
    /** Initial task prompt. */
    userInput: string;
    /** Supervised agent name: 'freeclaude' | 'codex' | … */
    agentName: string;
    /** global | chat | project */
    scope?: string;
    /** Extra metadata forwarded verbatim into the trajectory record. */
    metadata?: Record<string, unknown>;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}
export interface AcpToolCallTracker {
    recordEvent(event: AcpEvent): void;
    recordValidation(eventId: string, results: ValidatorResult[]): void;
    recordGateDecision(decision: GateDecision): void;
    recordInjection(text: string, attempt: number): void;
    finalize(stopReason: AcpStopReason, finalAnswer?: string, opts?: {
        tokensUsed?: number;
        costUsd?: number;
    }): Promise<void>;
    abort(reason: string): Promise<void>;
    state(): AcpBridgeState;
}
export interface AcpBridgeState {
    sessionId: string;
    toolCalls: ToolCallRecord[];
    validatorEvents: number;
    corrections: number;
    blocks: number;
    startedAt: number;
    finalised: boolean;
}
export declare function createAcpTrajectoryBridge(opts: AcpTrajectoryBridgeOptions): AcpToolCallTracker;
/**
 * Wires a live AcpSession's event stream into the bridge.
 *
 * Starts an async consumer that calls bridge.recordEvent() for every event
 * yielded by session.events().  When the iterator terminates naturally the
 * bridge is auto-finalised with stopReason='end_turn' if it has not already
 * been finalised.
 *
 * Returns an async disposer.  Calling the disposer detaches and finalises
 * the bridge (stopReason='end_turn') if not already done.
 */
export declare function attachBridgeToSession(session: AcpSession, bridge: AcpToolCallTracker): () => Promise<void>;
//# sourceMappingURL=acp-trajectory-bridge.d.ts.map