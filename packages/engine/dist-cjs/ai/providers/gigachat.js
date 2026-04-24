"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GigaChatProvider = void 0;
class GigaChatProvider {
    constructor(clientId, clientSecret) {
        this.name = 'gigachat';
        this.models = ['GigaChat', 'GigaChat-Plus', 'GigaChat-Pro'];
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        this.clientId = clientId || process.env.GIGACHAT_CLIENT_ID || '';
        this.clientSecret = clientSecret || process.env.GIGACHAT_CLIENT_SECRET || '';
    }
    async getToken() {
        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const https = require('https');
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const rquid = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
        const token = await new Promise((resolve, reject) => {
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
    }
    async chat(messages, options) {
        if (!this.clientId || !this.clientSecret) {
            throw new Error('GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET not set');
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const https = require('https');
        const token = await this.getToken();
        const model = options?.model || this.models[0];
        return new Promise((resolve, reject) => {
            const body = Buffer.from(JSON.stringify({
                model,
                messages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens ?? 4096,
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
            req.write(body);
            req.end();
        });
    }
}
exports.GigaChatProvider = GigaChatProvider;
