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
import { logger } from '../../observability/logger';

// ============================================
// Types
// ============================================

export type BusEventType =
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "analysis.complete"
  | "risk.detected"
  | "risk.critical"
  | "budget.alert"
  | "task.created"
  | "task.updated"
  | "collaboration.started"
  | "collaboration.completed"
  | "collaboration.failed"
  | "collaboration.step"
  | "workflow.progress"
  | "custom";

export interface BusMessage<T = unknown> {
  id: string;
  type: BusEventType;
  source: string;        // agentId or "system"
  target?: string;       // specific agentId or undefined for broadcast
  payload: T;
  workspaceId?: string;
  runId?: string;
  timestamp: Date;
  correlationId?: string; // links related messages
}

export type BusSubscriber<T = unknown> = (message: BusMessage<T>) => void | Promise<void>;

export interface BusSubscription {
  unsubscribe(): void;
}

// ============================================
// In-process message bus
// ============================================

export interface AgentBusPersistError {
  type: BusEventType;
  source: string;
  runId?: string;
  workspaceId?: string;
  error: string;
  at: string; // ISO timestamp
}

class AgentMessageBus extends EventEmitter {
  private messageLog: BusMessage[] = [];
  private readonly MAX_LOG_SIZE = 1000;
  private persistErrors: AgentBusPersistError[] = [];
  private readonly MAX_PERSIST_ERRORS = 100;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /** Expose a bounded tail of recent persist failures for ops dashboards. */
  getRecentPersistErrors(limit = 50): AgentBusPersistError[] {
    return this.persistErrors.slice(-limit).reverse();
  }

  /**
   * Publish a message to the bus.
   * Delivers to subscribers immediately (in-process).
   * Persists to DB asynchronously for audit trail.
   */
  async publish<T>(
    type: BusEventType,
    payload: T,
    options: {
      source: string;
      target?: string;
      workspaceId?: string;
      runId?: string;
      correlationId?: string;
    }
  ): Promise<BusMessage<T>> {
    const message: BusMessage<T> = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      source: options.source,
      target: options.target,
      payload,
      workspaceId: options.workspaceId,
      runId: options.runId,
      timestamp: new Date(),
      correlationId: options.correlationId,
    };

    this.emit(type, message);
    if (options.target) {
      this.emit(`target:${options.target}`, message);
    }
    this.emit("*", message);

    this.messageLog.push(message as BusMessage);
    if (this.messageLog.length > this.MAX_LOG_SIZE) {
      this.messageLog.shift();
    }

    void this.persistMessage(message as BusMessage);

    return message;
  }

  subscribe<T = unknown>(
    type: BusEventType | "*",
    handler: BusSubscriber<T>
  ): BusSubscription {
    const key = type === "*" ? "*" : type;
    const wrappedHandler = (msg: BusMessage<T>) => {
      try {
        const result = handler(msg);
        if (result instanceof Promise) {
          result.catch((err) => {
            logger.warn("agent-bus: subscriber error", {
              type,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        logger.warn("agent-bus: sync subscriber error", {
          type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    this.on(key, wrappedHandler as (msg: BusMessage) => void);

    return {
      unsubscribe: () => {
        this.off(key, wrappedHandler as (msg: BusMessage) => void);
      },
    };
  }

  /**
   * Subscribe to messages delivered to a specific agent target. The handler
   * also receives broadcast messages (target === undefined) so agents can
   * observe workspace-wide signals without double-subscribing to "*".
   */
  subscribeAgent<T = unknown>(
    agentId: string,
    handler: BusSubscriber<T>
  ): BusSubscription {
    const targetKey = `target:${agentId}`;
    const wildcardKey = "*";

    const wrappedHandler = (msg: BusMessage<T>) => {
      try {
        const result = handler(msg);
        if (result instanceof Promise) {
          result.catch((err) => {
            logger.warn("agent-bus: agent subscriber error", {
              agentId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        logger.warn("agent-bus: agent subscriber sync error", {
          agentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const broadcastHandler = (msg: BusMessage<T>) => {
      // Deliver broadcasts (no target) + messages explicitly targeted at this agent
      // (the target:<id> listener already covers the targeted case to avoid double delivery).
      if (msg.target === undefined) {
        wrappedHandler(msg);
      }
    };

    this.on(targetKey, wrappedHandler as (msg: BusMessage) => void);
    this.on(wildcardKey, broadcastHandler as (msg: BusMessage) => void);

    return {
      unsubscribe: () => {
        this.off(targetKey, wrappedHandler as (msg: BusMessage) => void);
        this.off(wildcardKey, broadcastHandler as (msg: BusMessage) => void);
      },
    };
  }

  getRecentMessages(options: {
    type?: BusEventType;
    source?: string;
    workspaceId?: string;
    limit?: number;
  } = {}): BusMessage[] {
    let msgs = this.messageLog;

    if (options.type) msgs = msgs.filter((m) => m.type === options.type);
    if (options.source) msgs = msgs.filter((m) => m.source === options.source);
    if (options.workspaceId) msgs = msgs.filter((m) => m.workspaceId === options.workspaceId);

    return msgs.slice(-(options.limit ?? 50)).reverse();
  }

  private async persistMessage(message: BusMessage): Promise<void> {
    try {
      const { prisma } = await import('../../prisma');
      await prisma.agentMessage.create({
        data: {
          id: message.id,
          type: message.type,
          source: message.source,
          target: message.target,
          payload: JSON.stringify(message.payload),
          workspaceId: message.workspaceId,
          runId: message.runId,
          correlationId: message.correlationId,
          createdAt: message.timestamp,
        },
      });
    } catch (err) {
      // Best-effort — log, never throw. Downstream consumers can replay from log via getRecentMessages().
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn("agent-bus: persistMessage failed", {
        type: message.type,
        source: message.source,
        runId: message.runId,
        error: errorMessage,
      });
      this.persistErrors.push({
        type: message.type,
        source: message.source,
        runId: message.runId,
        workspaceId: message.workspaceId,
        error: errorMessage,
        at: new Date().toISOString(),
      });
      if (this.persistErrors.length > this.MAX_PERSIST_ERRORS) {
        this.persistErrors.shift();
      }
    }
  }
}

let _bus: AgentMessageBus | null = null;

export function getAgentBus(): AgentMessageBus {
  if (!_bus) {
    _bus = new AgentMessageBus();
    logger.info("agent-bus: initialized");
  }
  return _bus;
}

export const agentBus = {
  publish: <T>(
    type: BusEventType,
    payload: T,
    options: { source: string; target?: string; workspaceId?: string; runId?: string; correlationId?: string }
  ) => getAgentBus().publish(type, payload, options),

  subscribe: <T = unknown>(type: BusEventType | "*", handler: BusSubscriber<T>) =>
    getAgentBus().subscribe(type, handler),

  subscribeAgent: <T = unknown>(agentId: string, handler: BusSubscriber<T>) =>
    getAgentBus().subscribeAgent(agentId, handler),

  recent: (options?: Parameters<AgentMessageBus["getRecentMessages"]>[0]) =>
    getAgentBus().getRecentMessages(options),

  recentPersistErrors: (limit?: number) =>
    getAgentBus().getRecentPersistErrors(limit),
};
