"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolzaProvider = void 0;
class PolzaProvider {
    constructor(apiKey) {
        this.name = 'polza';
        this.models = [
            'openai/gpt-4o-mini', 'openai/gpt-4o',
            'anthropic/claude-3.5-sonnet', 'anthropic/claude-3-haiku',
            'deepseek/deepseek-r1', 'deepseek/deepseek-chat',
            'qwen/qwen-2.5-coder', 'google/gemini-2.0-flash',
        ];
        this.baseUrl = 'https://polza.ai/api/v1';
        this.apiKey = apiKey || process.env.POLZA_API_KEY || '';
    }
    async chat(messages, options) {
        if (!this.apiKey)
            throw new Error('POLZA_API_KEY not set');
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options?.model || 'openai/gpt-4o-mini',
                messages,
                temperature: options?.temperature || 0.7,
                max_tokens: options?.maxTokens || 4096,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Polza.ai API error: ${response.status} - ${error}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
    }
}
exports.PolzaProvider = PolzaProvider;
