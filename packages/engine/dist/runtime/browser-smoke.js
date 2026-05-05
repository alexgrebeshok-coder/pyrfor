var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash } from 'node:crypto';
import { createBrowserController, } from './browser-control.js';
const URL_MAX_LENGTH = 2048;
const SELECTOR_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 200;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SENSITIVE_URL_QUERY_KEY_RE = /(token|secret|password|passwd|credential|signature|authorization|apikey|accesskey|keypairid)|(^|[-_])(auth|sig|pwd)([-_]|$)|^api[-_]?key$|^access[-_]?key$|^awsaccesskeyid$|^key[-_]?pair[-_]?id$|^x-amz-|^x-goog-|^x-oss-/i;
const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization)[A-Za-z0-9_.-]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
function cleanText(value, maxLength) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.length > maxLength)
        throw new Error(`BrowserSmoke: text exceeds ${maxLength} characters`);
    return trimmed;
}
function hashText(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function redactText(value) {
    return value
        .replace(SECRET_ASSIGNMENT_RE, (_match, key) => `${key}=[redacted]`)
        .slice(0, 300);
}
function normalizeLocalBrowserUrl(value) {
    const raw = cleanText(value, URL_MAX_LENGTH);
    if (!raw)
        throw new Error('BrowserSmoke: url is required');
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch (_a) {
        throw new Error('BrowserSmoke: url must be an absolute local http(s) URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('BrowserSmoke: url must use http or https');
    }
    if (parsed.username || parsed.password) {
        throw new Error('BrowserSmoke: url must not contain embedded credentials');
    }
    if (!LOCAL_HOSTS.has(parsed.hostname)) {
        throw new Error('BrowserSmoke: only localhost, 127.0.0.1 or ::1 targets are allowed');
    }
    parsed.hash = '';
    const normalized = parsed.toString();
    const publicParsed = new URL(normalized);
    for (const key of Array.from(publicParsed.searchParams.keys())) {
        if (SENSITIVE_URL_QUERY_KEY_RE.test(key)) {
            publicParsed.searchParams.set(key, 'redacted');
        }
    }
    return {
        url: normalized,
        publicUrl: publicParsed.toString(),
        host: parsed.host,
        path: parsed.pathname || '/',
        urlHash: hashText(normalized),
    };
}
export function normalizeBrowserSmokeInput(input) {
    var _a, _b;
    const url = normalizeLocalBrowserUrl(input.url);
    const selector = cleanText((_a = input.assertion) === null || _a === void 0 ? void 0 : _a.selector, SELECTOR_MAX_LENGTH);
    const containsText = cleanText((_b = input.assertion) === null || _b === void 0 ? void 0 : _b.containsText, TEXT_MAX_LENGTH);
    const fullPage = input.fullPage === true;
    const assertionPayload = JSON.stringify({
        selector: selector !== null && selector !== void 0 ? selector : null,
        containsTextHash: containsText ? hashText(containsText) : null,
    });
    return Object.assign(Object.assign(Object.assign(Object.assign({}, url), { fullPage }), (selector || containsText ? {
        assertion: Object.assign(Object.assign({}, (selector ? { selector } : {})), (containsText ? { containsText, containsTextHash: hashText(containsText) } : {})),
    } : {})), { assertionHash: hashText(assertionPayload), notes: (Array.isArray(input.notes) ? input.notes : [])
            .map((note) => cleanText(note, TEXT_MAX_LENGTH))
            .filter((note) => Boolean(note))
            .slice(0, 10) });
}
export function buildBrowserSmokeApprovalId(input, runId) {
    const digest = createHash('sha256')
        .update(`${runId}:${input.urlHash}:${input.assertionHash}:${input.fullPage ? 'full' : 'viewport'}`)
        .digest('hex')
        .slice(0, 24);
    return `browser-smoke:${digest}`;
}
export function runBrowserSmokeCapture(runId_1, input_1) {
    return __awaiter(this, arguments, void 0, function* (runId, input, options = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        const normalized = normalizeBrowserSmokeInput(input);
        const approvalId = cleanText(input.approvalId, 200);
        if (!approvalId)
            throw new Error('BrowserSmoke: approvalId is required');
        const controller = (_a = options.controller) !== null && _a !== void 0 ? _a : createBrowserController({
            launcher: options.launcher,
            defaultLaunchOpts: {
                kind: 'chromium',
                headless: true,
                actionTimeoutMs: 15000,
                navTimeoutMs: 15000,
                allowedHosts: [normalized.host],
            },
        });
        const executedAt = ((_b = options.now) !== null && _b !== void 0 ? _b : (() => new Date()))().toISOString();
        yield controller.launch({ kind: 'chromium', headless: true });
        try {
            const navigation = yield controller.navigate(normalized.url);
            if (!navigation.ok || !navigation.data) {
                throw new Error(`BrowserSmoke: navigate failed: ${(_c = navigation.error) !== null && _c !== void 0 ? _c : 'unknown error'}`);
            }
            const final = normalizeLocalBrowserUrl(navigation.data.url);
            let assertionMatched = true;
            if ((_d = normalized.assertion) === null || _d === void 0 ? void 0 : _d.selector) {
                const text = yield controller.getText(normalized.assertion.selector);
                if (!text.ok)
                    throw new Error(`BrowserSmoke: assertion selector failed: ${(_e = text.error) !== null && _e !== void 0 ? _e : 'unknown error'}`);
                if (normalized.assertion.containsText) {
                    assertionMatched = ((_f = text.data) !== null && _f !== void 0 ? _f : '').includes(normalized.assertion.containsText);
                }
            }
            const screenshot = yield controller.screenshot({ fullPage: normalized.fullPage });
            if (!screenshot.ok || !screenshot.data) {
                throw new Error(`BrowserSmoke: screenshot failed: ${(_g = screenshot.error) !== null && _g !== void 0 ? _g : 'unknown error'}`);
            }
            const snapshot = Object.assign(Object.assign({ schemaVersion: 'pyrfor.browser_smoke.v1', createdAt: executedAt, runId, status: assertionMatched ? 'passed' : 'failed', sourceMode: 'governed_browser_smoke', targetUrlHash: normalized.urlHash, targetHost: normalized.host, targetPathHash: hashText(normalized.path), finalHost: final.host, finalUrlHash: final.urlHash, title: redactText(navigation.data.title) }, (normalized.assertion ? {
                assertion: Object.assign(Object.assign(Object.assign({}, (normalized.assertion.selector ? { selector: redactText(normalized.assertion.selector) } : {})), (normalized.assertion.containsTextHash ? { containsTextHash: normalized.assertion.containsTextHash } : {})), { matched: assertionMatched }),
            } : {})), { effectsExecuted: [{
                        kind: 'browser_smoke',
                        approvalId,
                        executedAt,
                        targetUrlHash: normalized.urlHash,
                        finalUrlHash: final.urlHash,
                    }], notes: normalized.notes.map(redactText) });
            return {
                normalized,
                snapshot,
                screenshot: Buffer.from(screenshot.data),
            };
        }
        finally {
            yield controller.close();
        }
    });
}
