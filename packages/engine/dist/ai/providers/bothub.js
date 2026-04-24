var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class BothubProvider {
    constructor(apiKey) {
        this.name = 'bothub';
        this.models = ['gpt-4o-mini', 'gpt-4o', 'claude-3.5-sonnet', 'deepseek-r1', 'qwen-2.5-coder', 'yandexgpt'];
        this.baseUrl = 'https://bothub.chat/api/v1';
        this.apiKey = apiKey || process.env.BOTHUB_API_KEY || '';
    }
    chat(messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.apiKey)
                throw new Error('BOTHUB_API_KEY not set');
            const response = yield fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: (options === null || options === void 0 ? void 0 : options.model) || 'gpt-4o-mini',
                    messages,
                    temperature: (options === null || options === void 0 ? void 0 : options.temperature) || 0.7,
                    max_tokens: (options === null || options === void 0 ? void 0 : options.maxTokens) || 4096,
                }),
            });
            if (!response.ok) {
                const error = yield response.text();
                throw new Error(`Bothub API error: ${response.status} - ${error}`);
            }
            const data = yield response.json();
            return data.choices[0].message.content;
        });
    }
}
