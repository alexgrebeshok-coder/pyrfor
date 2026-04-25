/**
 * Base Agent - Abstract base class for all agents
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
import { getRouter } from '../../ai/providers.js';
import { getAgentSessionManager } from './agent-store.js';
// ============================================
// Base Agent
// ============================================
export class BaseAgent {
    constructor(config) {
        this.model = config.model;
        this.provider = config.provider;
        this.router = getRouter();
        this.sessions = getAgentSessionManager();
    }
    decorateSystemPrompt(basePrompt, context) {
        var _a;
        const toolInstructions = (_a = context === null || context === void 0 ? void 0 : context.metadata) === null || _a === void 0 ? void 0 : _a.toolInstructions;
        if (!toolInstructions) {
            return basePrompt;
        }
        return `${basePrompt}\n\n${toolInstructions}`;
    }
    /**
     * Build messages array for direct provider streaming (bypasses execute())
     */
    buildMessages(task, context) {
        const systemPrompt = this.decorateSystemPrompt(this.getSystemPrompt(context), context);
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: task },
        ];
    }
    /**
     * Expose provider and model for streaming path
     */
    getModel() { return this.model; }
    getProvider() { return this.provider; }
    /**
     * Chat with AI
     */
    chat(systemPrompt, userMessage, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const messages = [
                { role: 'system', content: this.decorateSystemPrompt(systemPrompt, context) },
                { role: 'user', content: userMessage },
            ];
            return this.router.chat(messages, {
                model: this.model,
                provider: this.provider,
            });
        });
    }
    /**
     * Run agent with session tracking
     */
    run(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            // Create session
            const session = yield this.sessions.createSession({
                agentId: this.id,
                task,
                model: this.model,
                provider: this.provider,
            });
            try {
                // Start session
                yield this.sessions.startSession(session.id);
                // Execute
                const result = yield this.execute(task, context);
                // Estimate tokens (rough: 4 chars per token)
                const tokens = Math.ceil((task.length + result.content.length) / 4);
                const cost = this.estimateCost(tokens);
                // Complete session
                yield this.sessions.completeSession(session.id, { content: result.content, data: result.data }, tokens, cost);
                return Object.assign(Object.assign({}, result), { tokens,
                    cost });
            }
            catch (error) {
                // Fail session
                yield this.sessions.failSession(session.id, error instanceof Error ? error.message : 'Unknown error');
                return {
                    success: false,
                    content: '',
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        });
    }
    /**
     * Estimate cost based on tokens
     */
    estimateCost(tokens) {
        // Rough estimates per 1K tokens
        const costs = {
            'gemini-3.1-flash-lite-preview': 0.00025,
            'glm-5': 0.001,
            'gpt-5.2': 0.005,
        };
        const costPer1K = costs[this.model] || 0.001;
        return (tokens / 1000) * costPer1K;
    }
}
