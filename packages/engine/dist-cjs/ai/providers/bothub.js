"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BothubProvider = void 0;
class BothubProvider {
    constructor(apiKey) {
        this.name = 'bothub';
        this.models = ['gpt-4o-mini', 'gpt-4o', 'claude-3.5-sonnet', 'deepseek-r1', 'qwen-2.5-coder', 'yandexgpt'];
        this.baseUrl = 'https://bothub.chat/api/v1';
        this.apiKey = apiKey || process.env.BOTHUB_API_KEY || '';
    }
    async chat(messages, options) {
        if (!this.apiKey)
            throw new Error('BOTHUB_API_KEY not set');
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options?.model || 'gpt-4o-mini',
                messages,
                temperature: options?.temperature || 0.7,
                max_tokens: options?.maxTokens || 4096,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Bothub API error: ${response.status} - ${error}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
    }
}
exports.BothubProvider = BothubProvider;
