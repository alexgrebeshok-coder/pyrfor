import { createMockAIAdapter } from "@/lib/ai/mock-adapter";
import type {
  AIAdapter,
  AIApplyProposalInput,
  AIRunInput,
  AIRunRecord,
} from "@/lib/ai/types";
import { logger } from "@/lib/logger";

const API_ROOT = "/api/ai";
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "AI gateway request failed.";
}

async function fetchWithRetry(url: string, init?: RequestInit, retries = 3, externalSignal?: AbortSignal): Promise<Response> {
  let lastError: Error | null = null;

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
        const payload = (await response.json()) as { error?: string };
        if (typeof payload.error === "string" && payload.error.trim().length) {
          errorMessage = payload.error;
        }
      } catch {
        // ignore malformed json
      }

      lastError = new Error(errorMessage);
      if (response.status < 500 && response.status !== 429 && response.status !== 408) {
        clearTimeout(timeoutId);
        throw lastError;
      }
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.name === "AbortError"
            ? new Error("AI request timed out.")
            : error
          : new Error(String(error));
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < retries - 1) {
      await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }
  }

  throw lastError ?? new Error("AI gateway request failed after retries.");
}

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal) {
  const response = await fetchWithRetry(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  }, 3, signal);

  return (await response.json()) as T;
}

export function createGatewayAIAdapter(): AIAdapter {
  const mockAdapter = createMockAIAdapter();
  const fallbackRuns = new Set<string>();
  const runStartedAt = new Map<string, number>();

  return {
    mode: "gateway",
    async runAgent(input: AIRunInput & { signal?: AbortSignal }) {
      logger.debug("GatewayAdapter runAgent called", { prompt: input.prompt?.substring(0, 50) });
      try {
        const { signal, ...restInput } = input;
        const run = await request<AIRunRecord>("/runs", {
          method: "POST",
          body: JSON.stringify(restInput),
        }, signal);
        logger.info("Gateway success", { runId: run.id });
        runStartedAt.set(run.id, Date.now());
        return run;
      } catch (error) {
        // Re-throw abort errors so they can be handled by the caller
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        logger.warn("Gateway failed, using mock fallback", { error: error instanceof Error ? error.message : String(error) });
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
    async getRun(runId: string) {
      const startedAt = runStartedAt.get(runId);
      if (startedAt && Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error("AI polling timed out after 5 minutes.");
      }

      if (fallbackRuns.has(runId)) {
        return mockAdapter.getRun(runId);
      }

      try {
        return await request<AIRunRecord>(`/runs/${runId}`);
      } catch (error) {
        throw new Error(normalizeErrorMessage(error));
      }
    },
    async applyProposal(input: AIApplyProposalInput) {
      if (fallbackRuns.has(input.runId)) {
        return mockAdapter.applyProposal(input);
      }

      try {
        return await request<AIRunRecord>(
          `/runs/${input.runId}/proposals/${input.proposalId}/apply`,
          {
            method: "POST",
          }
        );
      } catch (error) {
        throw new Error(normalizeErrorMessage(error));
      }
    },
  };
}
