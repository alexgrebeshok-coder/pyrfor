"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YandexGPTProvider = void 0;
class YandexGPTProvider {
    constructor(apiKey, folderId) {
        this.name = 'yandexgpt';
        this.models = ['yandexgpt-lite', 'yandexgpt', 'yandexgpt-32k'];
        this.apiKey = apiKey || process.env.YANDEXGPT_API_KEY || '';
        this.folderId = folderId || process.env.YANDEX_FOLDER_ID || '';
    }
    async chat(messages, options) {
        if (!this.apiKey || !this.folderId) {
            throw new Error('YANDEXGPT_API_KEY / YANDEX_FOLDER_ID not set');
        }
        const modelId = options?.model || this.models[0];
        const modelUri = `gpt://${this.folderId}/${modelId}`;
        // YandexGPT uses `text` instead of `content`
        const yandexMessages = messages.map(m => ({ role: m.role, text: m.content }));
        const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
            method: 'POST',
            headers: {
                'Authorization': `Api-Key ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                modelUri,
                completionOptions: {
                    stream: false,
                    temperature: options?.temperature ?? 0.6,
                    maxTokens: String(options?.maxTokens ?? 4096),
                },
                messages: yandexMessages,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`YandexGPT error ${response.status}: ${error}`);
        }
        const data = await response.json();
        return data.result.alternatives[0].message.text;
    }
}
exports.YandexGPTProvider = YandexGPTProvider;
