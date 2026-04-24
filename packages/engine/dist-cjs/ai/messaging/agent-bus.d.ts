/**
 * Agent Message Bus
 *
 * Lightweight pub/sub system for inter-agent communication.
 * Agents can publish events and subscribe to topics.
 *
 * Use cases:
 * - Agent A completes analysis → publishes "analysis.complete" → Agent B reacts
 * - Risk agent finds critical risk → publishes "risk.critical" → Director agent notified
 * - Workflow progress events → UI dashboard updates
 *
 * Persistence: messages stored in AgentMessage DB table for audit trail.
 * In-process delivery uses Node.js EventEmitter for low latency.
 */
import { EventEmitter } from "events";
export type BusEventType = "agent.started" | "agent.completed" | "agent.failed" | "analysis.complete" | "risk.detected" | "risk.critical" | "budget.alert" | "task.created" | "task.updated" | "collaboration.started" | "collaboration.completed" | "collaboration.failed" | "collaboration.step" | "workflow.progress" | "custom";
export interface BusMessage<T = unknown> {
    id: string;
    type: BusEventType;
    source: string;
    target?: string;
    payload: T;
    workspaceId?: string;
    runId?: string;
    timestamp: Date;
    correlationId?: string;
}
export type BusSubscriber<T = unknown> = (message: BusMessage<T>) => void | Promise<void>;
export interface BusSubscription {
    unsubscribe(): void;
}
export interface AgentBusPersistError {
    type: BusEventType;
    source: string;
    runId?: string;
    workspaceId?: string;
    error: string;
    at: string;
}
declare class AgentMessageBus extends EventEmitter {
    private messageLog;
    private readonly MAX_LOG_SIZE;
    private persistErrors;
    private readonly MAX_PERSIST_ERRORS;
    constructor();
    /** Expose a bounded tail of recent persist failures for ops dashboards. */
    getRecentPersistErrors(limit?: number): AgentBusPersistError[];
    /**
     * Publish a message to the bus.
     * Delivers to subscribers immediately (in-process).
     * Persists to DB asynchronously for audit trail.
     */
    publish<T>(type: BusEventType, payload: T, options: {
        source: string;
        target?: string;
        workspaceId?: string;
        runId?: string;
        correlationId?: string;
    }): Promise<BusMessage<T>>;
    subscribe<T = unknown>(type: BusEventType | "*", handler: BusSubscriber<T>): BusSubscription;
    /**
     * Subscribe to messages delivered to a specific agent target. The handler
     * also receives broadcast messages (target === undefined) so agents can
     * observe workspace-wide signals without double-subscribing to "*".
     */
    subscribeAgent<T = unknown>(agentId: string, handler: BusSubscriber<T>): BusSubscription;
    getRecentMessages(options?: {
        type?: BusEventType;
        source?: string;
        workspaceId?: string;
        limit?: number;
    }): BusMessage[];
    private persistMessage;
}
export declare function getAgentBus(): AgentMessageBus;
export declare const agentBus: {
    publish: <T>(type: BusEventType, payload: T, options: {
        source: string;
        target?: string;
        workspaceId?: string;
        runId?: string;
        correlationId?: string;
    }) => Promise<BusMessage<T>>;
    subscribe: <T = unknown>(type: BusEventType | "*", handler: BusSubscriber<T>) => BusSubscription;
    subscribeAgent: <T = unknown>(agentId: string, handler: BusSubscriber<T>) => BusSubscription;
    recent: (options?: Parameters<AgentMessageBus["getRecentMessages"]>[0]) => BusMessage<unknown>[];
    recentPersistErrors: (limit?: number) => AgentBusPersistError[];
};
export {};
//# sourceMappingURL=agent-bus.d.ts.map