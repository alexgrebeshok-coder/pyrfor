"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
class OpenAIProvider {
    constructor(apiKey) {
        this.name = 'openai';
        this.models = ['gpt-5.2', 'gpt-5.1', 'gpt-4o'];
        this.baseUrl = 'https://api.openai.com/v1';
        this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    }
    async chat(messages, options) {
        if (!this.apiKey)
            throw new Error('OPENAI_API_KEY not set');
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options?.model || 'gpt-5.2',
                messages,
                temperature: options?.temperature || 0.7,
                max_tokens: options?.maxTokens || 4096,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${error}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
    }
}
exports.OpenAIProvider = OpenAIProvider;
