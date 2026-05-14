import type { EventLedger, ToolSlotEvent } from '../event-ledger';
export interface ToolSlotManagerOptions {
    softCap?: number;
    hardCap?: number;
}
export interface ToolSlotRequest {
    runId: string;
    parentConceptId: string;
    capabilityFingerprint: string;
    toolName?: string;
    nodeId?: string;
    approvalId?: string;
    reason?: string;
}
export interface ToolSlotDecision {
    status: 'reserved' | 'duplicate' | 'blocked';
    reason: string;
    activeSlotCount: number;
    event?: ToolSlotEvent;
}
export interface ToolSlotMutation {
    status: 'committed' | 'released' | 'missing' | 'blocked';
    reason: string;
    event?: ToolSlotEvent;
}
export declare class ToolSlotManager {
    private readonly ledger;
    private static readonly processLineageLocks;
    private readonly softCap;
    private readonly hardCap;
    constructor(ledger: EventLedger, options?: ToolSlotManagerOptions);
    reserve(request: ToolSlotRequest): Promise<ToolSlotDecision>;
    commit(request: ToolSlotRequest): Promise<ToolSlotMutation>;
    release(request: ToolSlotRequest): Promise<ToolSlotMutation>;
    activeSlots(parentConceptId: string): Promise<ToolSlotEvent[]>;
    private readLineageSlots;
    private appendToolSlotEvent;
    private withLineageLock;
}
export declare class ToolSlotError extends Error {
    constructor(message: string);
}
export declare function capabilityFingerprint(input: unknown): string;
//# sourceMappingURL=tool-slot-manager.d.ts.map