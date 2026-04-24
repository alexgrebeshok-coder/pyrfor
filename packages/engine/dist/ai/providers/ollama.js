/**
 * Ollama Provider — Local LLM inference
 *
 * Connects to Ollama running on localhost:11434.
 * No API key required. Models must be pulled via `ollama pull <model>`.
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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
export class OllamaProvider {
    constructor(baseUrl) {
        this.name = 'ollama';
        this.models = ['qwen2.5:3b', 'llama3', 'mistral', 'gemma2'];
        this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    }
    chat(messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const model = (options === null || options === void 0 ? void 0 : options.model) || 'qwen2.5:3b';
            const response = yield fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages,
                    stream: false,
                    options: {
                        temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.7,
                        num_predict: (_b = options === null || options === void 0 ? void 0 : options.maxTokens) !== null && _b !== void 0 ? _b : 1024,
                    },
                }),
            });
            if (!response.ok) {
                const body = yield response.text();
                throw new Error(`Ollama error: ${response.status} - ${body}`);
            }
            const data = yield response.json();
            return ((_c = data.message) === null || _c === void 0 ? void 0 : _c.content) || '';
        });
    }
    chatStream(messages, options) {
        return __asyncGenerator(this, arguments, function* chatStream_1() {
            var _a, _b, _c, _d;
            const model = (options === null || options === void 0 ? void 0 : options.model) || 'qwen2.5:3b';
            const response = yield __await(fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages,
                    stream: true,
                    options: {
                        temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.7,
                        num_predict: (_b = options === null || options === void 0 ? void 0 : options.maxTokens) !== null && _b !== void 0 ? _b : 1024,
                    },
                }),
            }));
            if (!response.ok) {
                const body = yield __await(response.text());
                throw new Error(`Ollama error: ${response.status} - ${body}`);
            }
            const reader = (_c = response.body) === null || _c === void 0 ? void 0 : _c.getReader();
            if (!reader)
                throw new Error('No response body');
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = yield __await(reader.read());
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
                        if ((_d = chunk.message) === null || _d === void 0 ? void 0 : _d.content) {
                            yield yield __await(chunk.message.content);
                        }
                        if (chunk.done)
                            return yield __await(void 0);
                    }
                    catch (_e) {
                        // skip malformed JSON
                    }
                }
            }
        });
    }
    /** Check if Ollama is running */
    isAvailable() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield fetch(`${this.baseUrl}/api/tags`, {
                    signal: AbortSignal.timeout(3000),
                });
                return response.ok;
            }
            catch (_a) {
                return false;
            }
        });
    }
    /** List available models */
    listModels() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield fetch(`${this.baseUrl}/api/tags`, {
                    signal: AbortSignal.timeout(5000),
                });
                if (!response.ok)
                    return [];
                const data = yield response.json();
                return (data.models || []).map((m) => m.name);
            }
            catch (_a) {
                return [];
            }
        });
    }
}
