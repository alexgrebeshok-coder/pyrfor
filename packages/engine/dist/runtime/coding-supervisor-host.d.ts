import type { AcpEvent } from './acp-client';
import type { FCEvent } from './pyrfor-fc-adapter';
import type { WorkerProtocolBridge, WorkerProtocolBridgeResult } from './worker-protocol-bridge';
export interface CodingSupervisorHostOptions {
    workerBridge: Pick<WorkerProtocolBridge, 'handle'>;
    onFrameResult?: (result: WorkerProtocolBridgeResult, source: 'acp' | 'freeclaude') => void | Promise<void>;
    logger?: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
}
export declare class CodingSupervisorHost {
    private readonly workerBridge;
    private readonly onFrameResult;
    private readonly logger;
    constructor(options: CodingSupervisorHostOptions);
    handleAcpEvent(event: AcpEvent): Promise<WorkerProtocolBridgeResult | null>;
    handleFreeClaudeEvent(event: FCEvent): Promise<WorkerProtocolBridgeResult | null>;
    consumeAcpEvents(events: AsyncIterable<AcpEvent>): Promise<WorkerProtocolBridgeResult[]>;
    consumeFreeClaudeEvents(events: AsyncIterable<FCEvent>): Promise<WorkerProtocolBridgeResult[]>;
    private handleWorkerFrame;
}
//# sourceMappingURL=coding-supervisor-host.d.ts.map