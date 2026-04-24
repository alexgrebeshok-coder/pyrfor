var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class YandexGPTProvider {
    constructor(apiKey, folderId) {
        this.name = 'yandexgpt';
        this.models = ['yandexgpt-lite', 'yandexgpt', 'yandexgpt-32k'];
        this.apiKey = apiKey || process.env.YANDEXGPT_API_KEY || '';
        this.folderId = folderId || process.env.YANDEX_FOLDER_ID || '';
    }
    chat(messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (!this.apiKey || !this.folderId) {
                throw new Error('YANDEXGPT_API_KEY / YANDEX_FOLDER_ID not set');
            }
            const modelId = (options === null || options === void 0 ? void 0 : options.model) || this.models[0];
            const modelUri = `gpt://${this.folderId}/${modelId}`;
            // YandexGPT uses `text` instead of `content`
            const yandexMessages = messages.map(m => ({ role: m.role, text: m.content }));
            const response = yield fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
                method: 'POST',
                headers: {
                    'Authorization': `Api-Key ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    modelUri,
                    completionOptions: {
                        stream: false,
                        temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.6,
                        maxTokens: String((_b = options === null || options === void 0 ? void 0 : options.maxTokens) !== null && _b !== void 0 ? _b : 4096),
                    },
                    messages: yandexMessages,
                }),
            });
            if (!response.ok) {
                const error = yield response.text();
                throw new Error(`YandexGPT error ${response.status}: ${error}`);
            }
            const data = yield response.json();
            return data.result.alternatives[0].message.text;
        });
    }
}
