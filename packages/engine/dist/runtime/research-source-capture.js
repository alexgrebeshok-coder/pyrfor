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
import { lookup as dnsLookup } from 'node:dns/promises';
const URL_MAX_LENGTH = 2048;
const NOTE_MAX_LENGTH = 300;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 200000;
const MAX_CAPTURE_CHARS = 40000;
const MAX_EXCERPT_CHARS = 1000;
const DEFAULT_TIMEOUT_MS = 10000;
const SENSITIVE_URL_QUERY_KEY_RE = /(token|secret|password|passwd|credential|signature|authorization|apikey|accesskey|keypairid)|(^|[-_])(auth|sig|pwd)([-_]|$)|^api[-_]?key$|^access[-_]?key$|^awsaccesskeyid$|^key[-_]?pair[-_]?id$|^x-amz-|^x-goog-|^x-oss-/i;
const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization)[A-Za-z0-9_.-]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
function cleanText(value, maxLength) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.length > maxLength)
        throw new Error(`ResearchSourceCapture: text exceeds ${maxLength} characters`);
    return trimmed;
}
function hashText(value) {
    return createHash('sha256').update(value).digest('hex');
}
function parseIpv4(hostname) {
    const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match)
        return null;
    const parts = match.slice(1).map(Number);
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
        return null;
    return parts;
}
function parseIpv4MappedIpv6(hostname) {
    if (!hostname.startsWith('::ffff:'))
        return null;
    const suffix = hostname.slice('::ffff:'.length);
    const dotted = parseIpv4(suffix);
    if (dotted)
        return dotted;
    const hextets = suffix.split(':');
    if (hextets.length !== 2)
        return null;
    const high = Number.parseInt(hextets[0], 16);
    const low = Number.parseInt(hextets[1], 16);
    if (hextets.some((part) => !/^[0-9a-f]{1,4}$/i.test(part)) ||
        !Number.isInteger(high) ||
        !Number.isInteger(low))
        return null;
    return [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255];
}
function isPrivateIpv4([a, b]) {
    if (a === 0 || a === 10 || a === 127)
        return true;
    if (a === 100 && b >= 64 && b <= 127)
        return true;
    if (a === 169 && b === 254)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && (b === 0 || b === 168))
        return true;
    if (a === 198 && (b === 18 || b === 19))
        return true;
    if (a >= 224)
        return true;
    return false;
}
function isPrivateHostname(hostname) {
    const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (lower === 'localhost' || lower.endsWith('.localhost'))
        return true;
    const ipv4 = parseIpv4(lower);
    if (ipv4)
        return isPrivateIpv4(ipv4);
    const ipv4Mapped = parseIpv4MappedIpv6(lower);
    if (ipv4Mapped)
        return isPrivateIpv4(ipv4Mapped);
    if (!lower.includes(':'))
        return false;
    if (lower === '::' || lower === '::1')
        return true;
    const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);
    if (!Number.isInteger(firstHextet))
        return false;
    if ((firstHextet & 0xfe00) === 0xfc00)
        return true;
    if ((firstHextet & 0xffc0) === 0xfe80)
        return true;
    return false;
}
function publicUrl(parsed) {
    const clone = new URL(parsed.toString());
    for (const key of Array.from(clone.searchParams.keys())) {
        if (SENSITIVE_URL_QUERY_KEY_RE.test(key))
            clone.searchParams.set(key, 'redacted');
    }
    clone.pathname = clone.pathname === '/' ? '/' : '/redacted-path';
    clone.username = '';
    clone.password = '';
    clone.hash = '';
    return clone.toString();
}
function defaultResolveHostname(hostname) {
    return __awaiter(this, void 0, void 0, function* () {
        return dnsLookup(hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: false });
    });
}
function assertResolvedPublicTarget(input, resolveHostname) {
    return __awaiter(this, void 0, void 0, function* () {
        const parsed = new URL(input.url);
        const addresses = yield resolveHostname(parsed.hostname);
        if (addresses.length === 0) {
            throw new Error('ResearchSourceCapture: hostname did not resolve');
        }
        if (addresses.some((entry) => isPrivateHostname(entry.address))) {
            throw new Error('ResearchSourceCapture: DNS resolved to a local or private-network target');
        }
    });
}
export function normalizeResearchSourceCaptureInput(input) {
    const rawUrl = cleanText(input.url, URL_MAX_LENGTH);
    if (!rawUrl)
        throw new Error('ResearchSourceCapture: url is required');
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch (_a) {
        throw new Error('ResearchSourceCapture: url must be absolute');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('ResearchSourceCapture: url must use http or https');
    }
    if (parsed.username || parsed.password) {
        throw new Error('ResearchSourceCapture: url must not contain embedded credentials');
    }
    if (isPrivateHostname(parsed.hostname)) {
        throw new Error('ResearchSourceCapture: local and private-network targets are not allowed');
    }
    parsed.hash = '';
    const url = parsed.toString();
    const note = cleanText(input.note, NOTE_MAX_LENGTH);
    return Object.assign({ url, publicUrl: publicUrl(parsed), urlHash: hashText(url), host: parsed.host, pathHash: hashText(parsed.pathname || '/') }, (note ? { note: sanitizeText(note).slice(0, NOTE_MAX_LENGTH) } : {}));
}
export function buildResearchSourceCaptureApprovalId(input, runId) {
    return `research-source:${hashText(`${runId}:${input.urlHash}`).slice(0, 24)}`;
}
function sanitizeText(value) {
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(SECRET_ASSIGNMENT_RE, (_match, key) => `${key}=[redacted]`)
        .replace(/\s+/g, ' ')
        .trim();
}
function assertTextContentType(contentType) {
    var _a, _b;
    const normalized = (_b = (_a = contentType.toLowerCase().split(';')[0]) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : '';
    if (normalized !== 'text/html' && normalized !== 'text/plain') {
        throw new Error('ResearchSourceCapture: only text/html and text/plain responses are supported');
    }
}
function nextRedirectUrl(currentUrl, response) {
    if (![301, 302, 303, 307, 308].includes(response.status))
        return null;
    const location = response.headers.get('location');
    if (!location)
        throw new Error('ResearchSourceCapture: redirect missing location');
    return new URL(location, currentUrl).toString();
}
function readTextLimited(response) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const contentLength = response.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_BYTES) {
            throw new Error('ResearchSourceCapture: response exceeds maximum size');
        }
        const reader = (_a = response.body) === null || _a === void 0 ? void 0 : _a.getReader();
        if (!reader) {
            const text = yield response.text();
            const bytes = Buffer.byteLength(text);
            if (bytes > MAX_BYTES)
                throw new Error('ResearchSourceCapture: response exceeds maximum size');
            return { text, bytes, truncated: text.length > MAX_CAPTURE_CHARS };
        }
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = yield reader.read();
            if (done)
                break;
            if (!value)
                continue;
            total += value.byteLength;
            if (total > MAX_BYTES) {
                yield reader.cancel();
                throw new Error('ResearchSourceCapture: response exceeds maximum size');
            }
            chunks.push(value);
        }
        const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        return { text, bytes: buffer.length, truncated: text.length > MAX_CAPTURE_CHARS };
    });
}
export function runResearchSourceCapture(runId_1, input_1) {
    return __awaiter(this, arguments, void 0, function* (runId, input, opts = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const normalized = normalizeResearchSourceCaptureInput(input);
        const approvalId = cleanText(input.approvalId, 200);
        if (!approvalId)
            throw new Error('ResearchSourceCapture: approvalId is required');
        const fetchImpl = (_a = opts.fetchImpl) !== null && _a !== void 0 ? _a : globalThis.fetch;
        const resolveHostname = (_b = opts.resolveHostname) !== null && _b !== void 0 ? _b : defaultResolveHostname;
        const timeoutMs = (_c = opts.timeoutMs) !== null && _c !== void 0 ? _c : DEFAULT_TIMEOUT_MS;
        let current = normalized.url;
        let response = null;
        for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
            const currentNormalized = normalizeResearchSourceCaptureInput({ url: current });
            yield assertResolvedPublicTarget(currentNormalized, resolveHostname);
            response = yield fetchImpl(currentNormalized.url, {
                method: 'GET',
                redirect: 'manual',
                headers: { Accept: 'text/html,text/plain;q=0.9' },
                signal: AbortSignal.timeout(timeoutMs),
            });
            const redirected = nextRedirectUrl(currentNormalized.url, response);
            if (!redirected)
                break;
            if (redirect === MAX_REDIRECTS) {
                throw new Error('ResearchSourceCapture: too many redirects');
            }
            current = normalizeResearchSourceCaptureInput({ url: redirected }).url;
        }
        if (!response)
            throw new Error('ResearchSourceCapture: request failed');
        const final = normalizeResearchSourceCaptureInput({ url: current });
        if (!response.ok)
            throw new Error(`ResearchSourceCapture: HTTP ${response.status}`);
        const contentType = (_d = response.headers.get('content-type')) !== null && _d !== void 0 ? _d : '';
        assertTextContentType(contentType);
        const read = yield readTextLimited(response);
        const contentText = sanitizeText(read.text).slice(0, MAX_CAPTURE_CHARS);
        const title = contentType.toLowerCase().includes('text/html')
            ? sanitizeText((_f = (_e = read.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)) === null || _e === void 0 ? void 0 : _e[1]) !== null && _f !== void 0 ? _f : '').slice(0, 200)
            : undefined;
        const createdAt = ((_g = opts.now) !== null && _g !== void 0 ? _g : (() => new Date()))().toISOString();
        const snapshot = Object.assign(Object.assign(Object.assign(Object.assign({ schemaVersion: 'pyrfor.research_source_capture.v1', createdAt,
            runId, sourceMode: 'governed_source_capture', requestedUrl: normalized.publicUrl, requestedUrlHash: normalized.urlHash, requestedHost: normalized.host, requestedPathHash: normalized.pathHash, finalUrl: final.publicUrl, finalUrlHash: final.urlHash, finalHost: final.host, statusCode: response.status, contentType: ((_h = contentType.split(';')[0]) === null || _h === void 0 ? void 0 : _h.trim().toLowerCase()) || 'text/plain' }, (title ? { title } : {})), { contentHash: hashText(contentText), capturedBytes: read.bytes, truncated: read.truncated || contentText.length < sanitizeText(read.text).length, excerpt: contentText.slice(0, MAX_EXCERPT_CHARS) }), (normalized.note ? { note: normalized.note } : {})), { effectsExecuted: [{
                    kind: 'research_source_capture',
                    approvalId,
                    executedAt: createdAt,
                    requestedUrlHash: normalized.urlHash,
                    finalUrlHash: final.urlHash,
                }] });
        return {
            normalized,
            snapshot,
            artifactDocument: {
                snapshot,
                contentText,
            },
        };
    });
}
