"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZAIProvider = void 0;
class ZAIProvider {
    constructor(apiKey) {
        this.name = 'zai';
        this.models = ['glm-5', 'glm-4.7', 'glm-4.7-flash'];
        this.baseUrl = 'https://api.zukijourney.com/v1';
        this.apiKey = apiKey || process.env.ZAI_API_KEY || '';
    }
    async chat(messages, options) {
        if (!this.apiKey)
            throw new Error('ZAI_API_KEY not set');
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options?.model || 'glm-5',
                messages,
                temperature: options?.temperature || 0.7,
                max_tokens: options?.maxTokens || 4096,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`ZAI API error: ${response.status} - ${error}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
    }
}
exports.ZAIProvider = ZAIProvider;
