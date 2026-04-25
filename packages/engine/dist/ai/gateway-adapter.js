var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { createMockAIAdapter } from './mock-adapter.js';
import { logger } from '../observability/logger.js';
const API_ROOT = "/api/ai";
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return "AI gateway request failed.";
}
function fetchWithRetry(url_1, init_1) {
    return __awaiter(this, arguments, void 0, function* (url, init, retries = 3, externalSignal) {
        var _a;
        let lastError = null;
        for (let attempt = 0; attempt < retries; attempt += 1) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            // Combine external signal with internal timeout
            if (externalSignal) {
                if (externalSignal.aborted) {
                    clearTimeout(timeoutId);
                    throw new DOMException('The operation was aborted.', 'AbortError');
                }
                externalSignal.addEventListener('abort', () => controller.abort());
            }
            try {
                const response = yield fetch(url, Object.assign(Object.assign({}, init), { signal: controller.signal }));
                if (response.ok) {
                    clearTimeout(timeoutId);
                    return response;
                }
                let errorMessage = `AI gateway request failed: ${response.status}`;
                try {
                    const payload = (yield response.json());
                    if (typeof payload.error === "string" && payload.error.trim().length) {
                        errorMessage = payload.error;
                    }
                }
                catch (_b) {
                    // ignore malformed json
                }
                lastError = new Error(errorMessage);
                if (response.status < 500 && response.status !== 429 && response.status !== 408) {
                    clearTimeout(timeoutId);
                    throw lastError;
                }
            }
            catch (error) {
                lastError =
                    error instanceof Error
                        ? error.name === "AbortError"
                            ? new Error("AI request timed out.")
                            : error
                        : new Error(String(error));
            }
            finally {
                clearTimeout(timeoutId);
            }
            if (attempt < retries - 1) {
                yield sleep((_a = RETRY_DELAYS_MS[attempt]) !== null && _a !== void 0 ? _a : RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
            }
        }
        throw lastError !== null && lastError !== void 0 ? lastError : new Error("AI gateway request failed after retries.");
    });
}
function request(path, init, signal) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const response = yield fetchWithRetry(`${API_ROOT}${path}`, Object.assign(Object.assign({}, init), { headers: Object.assign({ "Content-Type": "application/json" }, ((_a = init === null || init === void 0 ? void 0 : init.headers) !== null && _a !== void 0 ? _a : {})) }), 3, signal);
        return (yield response.json());
    });
}
export function createGatewayAIAdapter() {
    const mockAdapter = createMockAIAdapter();
    const fallbackRuns = new Set();
    const runStartedAt = new Map();
    return {
        mode: "gateway",
        runAgent(input) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                logger.debug("GatewayAdapter runAgent called", { prompt: (_a = input.prompt) === null || _a === void 0 ? void 0 : _a.substring(0, 50) });
                try {
                    const { signal } = input, restInput = __rest(input, ["signal"]);
                    const run = yield request("/runs", {
                        method: "POST",
                        body: JSON.stringify(restInput),
                    }, signal);
                    logger.info("Gateway success", { runId: run.id });
                    runStartedAt.set(run.id, Date.now());
                    return run;
                }
                catch (error) {
                    // Re-throw abort errors so they can be handled by the caller
                    if (error instanceof Error && error.name === 'AbortError') {
                        throw error;
                    }
                    logger.warn("Gateway failed, using mock fallback", { error: error instanceof Error ? error.message : String(error) });
                    const { signal } = input, restInput = __rest(input, ["signal"]);
                    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
                        throw error;
                    }
                    const run = yield mockAdapter.runAgent(restInput);
                    fallbackRuns.add(run.id);
                    runStartedAt.set(run.id, Date.now());
                    return run;
                }
            });
        },
        getRun(runId) {
            return __awaiter(this, void 0, void 0, function* () {
                const startedAt = runStartedAt.get(runId);
                if (startedAt && Date.now() - startedAt > POLL_TIMEOUT_MS) {
                    throw new Error("AI polling timed out after 5 minutes.");
                }
                if (fallbackRuns.has(runId)) {
                    return mockAdapter.getRun(runId);
                }
                try {
                    return yield request(`/runs/${runId}`);
                }
                catch (error) {
                    throw new Error(normalizeErrorMessage(error));
                }
            });
        },
        applyProposal(input) {
            return __awaiter(this, void 0, void 0, function* () {
                if (fallbackRuns.has(input.runId)) {
                    return mockAdapter.applyProposal(input);
                }
                try {
                    return yield request(`/runs/${input.runId}/proposals/${input.proposalId}/apply`, {
                        method: "POST",
                    });
                }
                catch (error) {
                    throw new Error(normalizeErrorMessage(error));
                }
            });
        },
    };
}
