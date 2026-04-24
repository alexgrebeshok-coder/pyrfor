"use strict";
/**
 * Base Agent - Abstract base class for all agents
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAgent = void 0;
const providers_1 = require("../../ai/providers");
const agent_store_1 = require("./agent-store");
// ============================================
// Base Agent
// ============================================
class BaseAgent {
    constructor(config) {
        this.model = config.model;
        this.provider = config.provider;
        this.router = (0, providers_1.getRouter)();
        this.sessions = (0, agent_store_1.getAgentSessionManager)();
    }
    decorateSystemPrompt(basePrompt, context) {
        const toolInstructions = context?.metadata?.toolInstructions;
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
    async chat(systemPrompt, userMessage, context) {
        const messages = [
            { role: 'system', content: this.decorateSystemPrompt(systemPrompt, context) },
            { role: 'user', content: userMessage },
        ];
        return this.router.chat(messages, {
            model: this.model,
            provider: this.provider,
        });
    }
    /**
     * Run agent with session tracking
     */
    async run(task, context) {
        // Create session
        const session = await this.sessions.createSession({
            agentId: this.id,
            task,
            model: this.model,
            provider: this.provider,
        });
        try {
            // Start session
            await this.sessions.startSession(session.id);
            // Execute
            const result = await this.execute(task, context);
            // Estimate tokens (rough: 4 chars per token)
            const tokens = Math.ceil((task.length + result.content.length) / 4);
            const cost = this.estimateCost(tokens);
            // Complete session
            await this.sessions.completeSession(session.id, { content: result.content, data: result.data }, tokens, cost);
            return {
                ...result,
                tokens,
                cost,
            };
        }
        catch (error) {
            // Fail session
            await this.sessions.failSession(session.id, error instanceof Error ? error.message : 'Unknown error');
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
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
exports.BaseAgent = BaseAgent;
