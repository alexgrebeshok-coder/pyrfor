"use strict";
/**
 * Ollama Provider — Local LLM inference
 *
 * Connects to Ollama running on localhost:11434.
 * No API key required. Models must be pulled via `ollama pull <model>`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
class OllamaProvider {
    constructor(baseUrl) {
        this.name = 'ollama';
        this.models = ['qwen2.5:3b', 'llama3', 'mistral', 'gemma2'];
        this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    }
    async chat(messages, options) {
        const model = options?.model || 'qwen2.5:3b';
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                options: {
                    temperature: options?.temperature ?? 0.7,
                    num_predict: options?.maxTokens ?? 1024,
                },
            }),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Ollama error: ${response.status} - ${body}`);
        }
        const data = await response.json();
        return data.message?.content || '';
    }
    async *chatStream(messages, options) {
        const model = options?.model || 'qwen2.5:3b';
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                options: {
                    temperature: options?.temperature ?? 0.7,
                    num_predict: options?.maxTokens ?? 1024,
                },
            }),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Ollama error: ${response.status} - ${body}`);
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const chunk = JSON.parse(line);
                    if (chunk.message?.content) {
                        yield chunk.message.content;
                    }
                    if (chunk.done)
                        return;
                }
                catch {
                    // skip malformed JSON
                }
            }
        }
    }
    /** Check if Ollama is running */
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /** List available models */
    async listModels() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok)
                return [];
            const data = await response.json();
            return (data.models || []).map((m) => m.name);
        }
        catch {
            return [];
        }
    }
}
exports.OllamaProvider = OllamaProvider;
