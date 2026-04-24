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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { EventEmitter } from "events";
import { logger } from '../../observability/logger';
class AgentMessageBus extends EventEmitter {
    constructor() {
        super();
        this.messageLog = [];
        this.MAX_LOG_SIZE = 1000;
        this.persistErrors = [];
        this.MAX_PERSIST_ERRORS = 100;
        this.setMaxListeners(100);
    }
    /** Expose a bounded tail of recent persist failures for ops dashboards. */
    getRecentPersistErrors(limit = 50) {
        return this.persistErrors.slice(-limit).reverse();
    }
    /**
     * Publish a message to the bus.
     * Delivers to subscribers immediately (in-process).
     * Persists to DB asynchronously for audit trail.
     */
    publish(type, payload, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const message = {
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
            this.messageLog.push(message);
            if (this.messageLog.length > this.MAX_LOG_SIZE) {
                this.messageLog.shift();
            }
            void this.persistMessage(message);
            return message;
        });
    }
    subscribe(type, handler) {
        const key = type === "*" ? "*" : type;
        const wrappedHandler = (msg) => {
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
            }
            catch (err) {
                logger.warn("agent-bus: sync subscriber error", {
                    type,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        };
        this.on(key, wrappedHandler);
        return {
            unsubscribe: () => {
                this.off(key, wrappedHandler);
            },
        };
    }
    /**
     * Subscribe to messages delivered to a specific agent target. The handler
     * also receives broadcast messages (target === undefined) so agents can
     * observe workspace-wide signals without double-subscribing to "*".
     */
    subscribeAgent(agentId, handler) {
        const targetKey = `target:${agentId}`;
        const wildcardKey = "*";
        const wrappedHandler = (msg) => {
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
            }
            catch (err) {
                logger.warn("agent-bus: agent subscriber sync error", {
                    agentId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        };
        const broadcastHandler = (msg) => {
            // Deliver broadcasts (no target) + messages explicitly targeted at this agent
            // (the target:<id> listener already covers the targeted case to avoid double delivery).
            if (msg.target === undefined) {
                wrappedHandler(msg);
            }
        };
        this.on(targetKey, wrappedHandler);
        this.on(wildcardKey, broadcastHandler);
        return {
            unsubscribe: () => {
                this.off(targetKey, wrappedHandler);
                this.off(wildcardKey, broadcastHandler);
            },
        };
    }
    getRecentMessages(options = {}) {
        var _a;
        let msgs = this.messageLog;
        if (options.type)
            msgs = msgs.filter((m) => m.type === options.type);
        if (options.source)
            msgs = msgs.filter((m) => m.source === options.source);
        if (options.workspaceId)
            msgs = msgs.filter((m) => m.workspaceId === options.workspaceId);
        return msgs.slice(-((_a = options.limit) !== null && _a !== void 0 ? _a : 50)).reverse();
    }
    persistMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { prisma } = yield import('../../prisma');
                yield prisma.agentMessage.create({
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
            }
            catch (err) {
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
        });
    }
}
let _bus = null;
export function getAgentBus() {
    if (!_bus) {
        _bus = new AgentMessageBus();
        logger.info("agent-bus: initialized");
    }
    return _bus;
}
export const agentBus = {
    publish: (type, payload, options) => getAgentBus().publish(type, payload, options),
    subscribe: (type, handler) => getAgentBus().subscribe(type, handler),
    subscribeAgent: (agentId, handler) => getAgentBus().subscribeAgent(agentId, handler),
    recent: (options) => getAgentBus().getRecentMessages(options),
    recentPersistErrors: (limit) => getAgentBus().getRecentPersistErrors(limit),
};
