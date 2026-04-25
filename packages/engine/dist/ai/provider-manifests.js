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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
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
import OpenAI from "openai";
import { logger } from '../observability/logger.js';
export const AI_PROVIDER_MANIFESTS_ENV = "CEOCLAW_AI_PROVIDER_MANIFESTS";
function tryParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch (_a) {
        return undefined;
    }
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function normalizeProviderManifest(value, index) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        logger.warn("Skipping invalid AI provider manifest entry", {
            index,
            reason: "not an object",
        });
        return null;
    }
    const record = value;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const baseURL = typeof record.baseURL === "string" ? record.baseURL.trim() : "";
    const apiKeyEnvVar = typeof record.apiKeyEnvVar === "string" ? record.apiKeyEnvVar.trim() : "";
    const defaultModel = typeof record.defaultModel === "string" ? record.defaultModel.trim() : "";
    const models = normalizeStringArray(record.models);
    const displayName = typeof record.displayName === "string" ? record.displayName.trim() : undefined;
    const description = typeof record.description === "string" ? record.description.trim() : undefined;
    const timeoutMs = typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)
        ? record.timeoutMs
        : undefined;
    if (!name || !baseURL || !apiKeyEnvVar || !defaultModel) {
        logger.warn("Skipping invalid AI provider manifest entry", {
            index,
            name: name || null,
            reason: "missing required fields",
        });
        return null;
    }
    return {
        name,
        baseURL,
        apiKeyEnvVar,
        defaultModel,
        models: models.length > 0 ? models : [defaultModel],
        displayName,
        description,
        timeoutMs,
    };
}
export function loadConfiguredAIProviderManifests(env = process.env) {
    const raw = env[AI_PROVIDER_MANIFESTS_ENV];
    if (!(raw === null || raw === void 0 ? void 0 : raw.trim())) {
        return [];
    }
    const parsed = tryParseJson(raw);
    if (!Array.isArray(parsed)) {
        logger.warn("AI provider manifests must be a JSON array", {
            envVar: AI_PROVIDER_MANIFESTS_ENV,
        });
        return [];
    }
    return parsed
        .map((item, index) => normalizeProviderManifest(item, index))
        .filter((item) => Boolean(item));
}
export function createConfiguredAIProvider(manifest, env = process.env) {
    var _a;
    const getApiKey = () => { var _a; return ((_a = env[manifest.apiKeyEnvVar]) === null || _a === void 0 ? void 0 : _a.trim()) || ""; };
    return {
        name: manifest.name,
        models: (_a = manifest.models) !== null && _a !== void 0 ? _a : [manifest.defaultModel],
        chat(messages, options) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f;
                const apiKey = getApiKey();
                if (!apiKey) {
                    throw new Error(`${manifest.apiKeyEnvVar} not set`);
                }
                const client = new OpenAI({
                    apiKey,
                    baseURL: manifest.baseURL,
                    timeout: (_a = manifest.timeoutMs) !== null && _a !== void 0 ? _a : 30000,
                });
                const response = yield client.chat.completions.create({
                    model: (options === null || options === void 0 ? void 0 : options.model) || manifest.defaultModel,
                    messages,
                    temperature: (_b = options === null || options === void 0 ? void 0 : options.temperature) !== null && _b !== void 0 ? _b : 0.7,
                    max_tokens: (_c = options === null || options === void 0 ? void 0 : options.maxTokens) !== null && _c !== void 0 ? _c : 4096,
                });
                return (_f = (_e = (_d = response.choices[0]) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.content) !== null && _f !== void 0 ? _f : "";
            });
        },
        chatStream(messages, options) {
            return __asyncGenerator(this, arguments, function* chatStream_1() {
                var _a, e_1, _b, _c;
                var _d, _e, _f, _g, _h;
                const apiKey = getApiKey();
                if (!apiKey) {
                    throw new Error(`${manifest.apiKeyEnvVar} not set`);
                }
                const client = new OpenAI({
                    apiKey,
                    baseURL: manifest.baseURL,
                    timeout: (_d = manifest.timeoutMs) !== null && _d !== void 0 ? _d : 30000,
                });
                const stream = yield __await(client.chat.completions.create({
                    model: (options === null || options === void 0 ? void 0 : options.model) || manifest.defaultModel,
                    messages,
                    temperature: (_e = options === null || options === void 0 ? void 0 : options.temperature) !== null && _e !== void 0 ? _e : 0.7,
                    max_tokens: (_f = options === null || options === void 0 ? void 0 : options.maxTokens) !== null && _f !== void 0 ? _f : 4096,
                    stream: true,
                }));
                try {
                    for (var _j = true, stream_1 = __asyncValues(stream), stream_1_1; stream_1_1 = yield __await(stream_1.next()), _a = stream_1_1.done, !_a; _j = true) {
                        _c = stream_1_1.value;
                        _j = false;
                        const chunk = _c;
                        const content = (_h = (_g = chunk.choices[0]) === null || _g === void 0 ? void 0 : _g.delta) === null || _h === void 0 ? void 0 : _h.content;
                        if (content) {
                            yield yield __await(content);
                        }
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (!_j && !_a && (_b = stream_1.return)) yield __await(_b.call(stream_1));
                    }
                    finally { if (e_1) throw e_1.error; }
                }
            });
        },
    };
}
