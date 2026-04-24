"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGatewayAIAdapter = createGatewayAIAdapter;
const mock_adapter_1 = require("./mock-adapter");
const logger_1 = require("../observability/logger");
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
async function fetchWithRetry(url, init, retries = 3, externalSignal) {
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
            const response = await fetch(url, {
                ...init,
                signal: controller.signal,
            });
            if (response.ok) {
                clearTimeout(timeoutId);
                return response;
            }
            let errorMessage = `AI gateway request failed: ${response.status}`;
            try {
                const payload = (await response.json());
                if (typeof payload.error === "string" && payload.error.trim().length) {
                    errorMessage = payload.error;
                }
            }
            catch {
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
            await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
        }
    }
    throw lastError ?? new Error("AI gateway request failed after retries.");
}
async function request(path, init, signal) {
    const response = await fetchWithRetry(`${API_ROOT}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    }, 3, signal);
    return (await response.json());
}
function createGatewayAIAdapter() {
    const mockAdapter = (0, mock_adapter_1.createMockAIAdapter)();
    const fallbackRuns = new Set();
    const runStartedAt = new Map();
    return {
        mode: "gateway",
        async runAgent(input) {
            logger_1.logger.debug("GatewayAdapter runAgent called", { prompt: input.prompt?.substring(0, 50) });
            try {
                const { signal, ...restInput } = input;
                const run = await request("/runs", {
                    method: "POST",
                    body: JSON.stringify(restInput),
                }, signal);
                logger_1.logger.info("Gateway success", { runId: run.id });
                runStartedAt.set(run.id, Date.now());
                return run;
            }
            catch (error) {
                // Re-throw abort errors so they can be handled by the caller
                if (error instanceof Error && error.name === 'AbortError') {
                    throw error;
                }
                logger_1.logger.warn("Gateway failed, using mock fallback", { error: error instanceof Error ? error.message : String(error) });
                const { signal, ...restInput } = input;
                if (signal?.aborted) {
                    throw error;
                }
                const run = await mockAdapter.runAgent(restInput);
                fallbackRuns.add(run.id);
                runStartedAt.set(run.id, Date.now());
                return run;
            }
        },
        async getRun(runId) {
            const startedAt = runStartedAt.get(runId);
            if (startedAt && Date.now() - startedAt > POLL_TIMEOUT_MS) {
                throw new Error("AI polling timed out after 5 minutes.");
            }
            if (fallbackRuns.has(runId)) {
                return mockAdapter.getRun(runId);
            }
            try {
                return await request(`/runs/${runId}`);
            }
            catch (error) {
                throw new Error(normalizeErrorMessage(error));
            }
        },
        async applyProposal(input) {
            if (fallbackRuns.has(input.runId)) {
                return mockAdapter.applyProposal(input);
            }
            try {
                return await request(`/runs/${input.runId}/proposals/${input.proposalId}/apply`, {
                    method: "POST",
                });
            }
            catch (error) {
                throw new Error(normalizeErrorMessage(error));
            }
        },
    };
}
