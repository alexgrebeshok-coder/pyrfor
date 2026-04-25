var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class GigaChatProvider {
    constructor(clientId, clientSecret) {
        this.name = 'gigachat';
        this.models = ['GigaChat', 'GigaChat-Plus', 'GigaChat-Pro'];
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        this.clientId = clientId || process.env.GIGACHAT_CLIENT_ID || '';
        this.clientSecret = clientSecret || process.env.GIGACHAT_CLIENT_SECRET || '';
    }
    getToken() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this.accessToken && Date.now() < this.tokenExpiresAt) {
                return this.accessToken;
            }
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const https = require('https');
            const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
            const rquid = ((_a = crypto.randomUUID) === null || _a === void 0 ? void 0 : _a.call(crypto)) || Math.random().toString(36).slice(2);
            const token = yield new Promise((resolve, reject) => {
                const body = Buffer.from('scope=GIGACHAT_API_PERS');
                const req = https.request({
                    hostname: 'ngw.devices.sberbank.ru',
                    port: 9443,
                    path: '/api/v2/oauth',
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${credentials}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'RqUID': rquid,
                        'Content-Length': body.length,
                    },
                    rejectUnauthorized: false,
                }, (res) => {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        try {
                            const data = JSON.parse(Buffer.concat(chunks).toString());
                            resolve(data.access_token);
                        }
                        catch (e) {
                            reject(e);
                        }
                    });
                });
                req.on('error', reject);
                req.write(body);
                req.end();
            });
            this.accessToken = token;
            this.tokenExpiresAt = Date.now() + 25 * 60 * 1000;
            return token;
        });
    }
    chat(messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.clientId || !this.clientSecret) {
                throw new Error('GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET not set');
            }
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const https = require('https');
            const token = yield this.getToken();
            const model = (options === null || options === void 0 ? void 0 : options.model) || this.models[0];
            return new Promise((resolve, reject) => {
                var _a, _b;
                const body = Buffer.from(JSON.stringify({
                    model,
                    messages,
                    temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.7,
                    max_tokens: (_b = options === null || options === void 0 ? void 0 : options.maxTokens) !== null && _b !== void 0 ? _b : 4096,
                }));
                const req = https.request({
                    hostname: 'gigachat.devices.sberbank.ru',
                    port: 443,
                    path: '/api/v1/chat/completions',
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Content-Length': body.length,
                    },
                    rejectUnauthorized: false,
                }, (res) => {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        try {
                            const data = JSON.parse(Buffer.concat(chunks).toString());
                            if (res.statusCode && res.statusCode >= 400) {
                                throw new Error(`GigaChat error ${res.statusCode}: ${JSON.stringify(data)}`);
                            }
                            resolve(data.choices[0].message.content);
                        }
                        catch (e) {
                            reject(e);
                        }
                    });
                });
                req.on('error', reject);
                if (options === null || options === void 0 ? void 0 : options.signal) {
                    if (options.signal.aborted) {
                        req.destroy(new Error('Request aborted'));
                        return;
                    }
                    options.signal.addEventListener('abort', () => {
                        req.destroy(new Error('Request aborted'));
                    }, { once: true });
                }
                req.write(body);
                req.end();
            });
        });
    }
}
