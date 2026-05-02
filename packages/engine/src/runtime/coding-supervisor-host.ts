import type { AcpEvent } from './acp-client';
import type { FCEvent } from './pyrfor-fc-adapter';
import type { WorkerProtocolBridge, WorkerProtocolBridgeResult } from './worker-protocol-bridge';

export interface CodingSupervisorHostOptions {
  workerBridge: Pick<WorkerProtocolBridge, 'handle'>;
  onFrameResult?: (result: WorkerProtocolBridgeResult, source: 'acp' | 'freeclaude') => void | Promise<void>;
  logger?: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
}

export class CodingSupervisorHost {
  private readonly workerBridge: Pick<WorkerProtocolBridge, 'handle'>;
  private readonly onFrameResult: CodingSupervisorHostOptions['onFrameResult'];
  private readonly logger: CodingSupervisorHostOptions['logger'];

  constructor(options: CodingSupervisorHostOptions) {
    this.workerBridge = options.workerBridge;
    this.onFrameResult = options.onFrameResult;
    this.logger = options.logger;
  }

  async handleAcpEvent(event: AcpEvent): Promise<WorkerProtocolBridgeResult | null> {
    if (event.type !== 'worker_frame') return null;
    return this.handleWorkerFrame(event.data, 'acp');
  }

  async handleFreeClaudeEvent(event: FCEvent): Promise<WorkerProtocolBridgeResult | null> {
    if (event.type !== 'worker_frame') return null;
    return this.handleWorkerFrame(event.frame, 'freeclaude');
  }

  async consumeAcpEvents(events: AsyncIterable<AcpEvent>): Promise<WorkerProtocolBridgeResult[]> {
    const results: WorkerProtocolBridgeResult[] = [];
    for await (const event of events) {
      const result = await this.handleAcpEvent(event);
      if (result) results.push(result);
    }
    return results;
  }

  async consumeFreeClaudeEvents(events: AsyncIterable<FCEvent>): Promise<WorkerProtocolBridgeResult[]> {
    const results: WorkerProtocolBridgeResult[] = [];
    for await (const event of events) {
      const result = await this.handleFreeClaudeEvent(event);
      if (result) results.push(result);
    }
    return results;
  }

  private async handleWorkerFrame(
    frame: unknown,
    source: 'acp' | 'freeclaude',
  ): Promise<WorkerProtocolBridgeResult> {
    const result = await this.workerBridge.handle(frame);
    await this.onFrameResult?.(result, source);
    if (!result.ok) {
      this.logger?.('warn', 'coding-supervisor-host: worker frame rejected', { source, result });
    }
    return result;
  }
}
