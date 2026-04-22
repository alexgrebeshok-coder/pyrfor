import { buildGatewayPrompt, parseGatewayResult } from './openclaw-gateway';
import { applyAIProposal } from './action-engine';
import { attachRunGrounding } from './grounding';
import { runDesktopLocalGatewayPrompt } from '../desktop/local-gateway';
import type { AIAdapter, AIApplyProposalInput, AIRunInput, AIRunRecord } from './types';
import { logger } from '../observability/logger';

type LocalRunStoreEntry = {
  input: AIRunInput;
  run: AIRunRecord;
  finalRun?: AIRunRecord;
};

const runStore = new Map<string, LocalRunStoreEntry>();

function createRunId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ai-run-${crypto.randomUUID()}`;
  }

  return `ai-run-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneRun(run: AIRunRecord) {
  return JSON.parse(JSON.stringify(run)) as AIRunRecord;
}

function createQueuedRun(input: AIRunInput, runId: string): AIRunRecord {
  const now = new Date().toISOString();

  return {
    id: runId,
    sessionId: input.sessionId,
    agentId: input.agent.id,
    title: "AI Workspace Run",
    prompt: input.prompt,
    quickActionId: input.quickAction?.id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    context: input.context.activeContext,
  };
}

function createFailedRun(run: AIRunRecord, error: unknown): AIRunRecord {
  const message = error instanceof Error ? error.message : String(error);

  return {
    ...run,
    status: "failed",
    updatedAt: new Date().toISOString(),
    errorMessage: message,
    result: {
      title: "Local AI gateway failed",
      summary: message,
      highlights: [message],
      nextSteps: [],
      proposal: null,
    },
  };
}

function buildSessionKey(runId: string) {
  return `pm-dashboard:${runId}`;
}

export function createDesktopLocalGatewayAdapter(): AIAdapter {
  return {
    mode: "gateway",
    async runAgent(input: AIRunInput & { signal?: AbortSignal }) {
      const { signal, ...restInput } = input;
      const runId = createRunId();
      const run = createQueuedRun(restInput, runId);
      runStore.set(runId, { input: restInput, run });

      if (signal?.aborted) {
        throw new Error("Request aborted");
      }

      try {
        const prompt = buildGatewayPrompt(restInput, runId);
        const response = await runDesktopLocalGatewayPrompt({
          prompt,
          runId,
          sessionKey: buildSessionKey(runId),
          model: "openclaw:main",
        });

        const result = attachRunGrounding(parseGatewayResult(response.content, runId), restInput);
        const finalRun: AIRunRecord = {
          ...run,
          title: result.title || run.title,
          status: "done",
          updatedAt: new Date().toISOString(),
          result,
        };

        runStore.set(runId, {
          input: restInput,
          run,
          finalRun,
        });

        return cloneRun(finalRun);
      } catch (error) {
        logger.warn("Local desktop gateway failed", {
          error: error instanceof Error ? error.message : String(error),
        });

        const failedRun = createFailedRun(run, error);
        runStore.set(runId, {
          input: restInput,
          run,
          finalRun: failedRun,
        });

        return cloneRun(failedRun);
      }
    },
    async getRun(runId: string) {
      const entry = runStore.get(runId);
      if (!entry) {
        throw new Error(`Unknown local gateway run: ${runId}`);
      }

      return cloneRun(entry.finalRun ?? entry.run);
    },
    async applyProposal(input: AIApplyProposalInput) {
      const entry = runStore.get(input.runId);
      const run = entry?.finalRun ?? entry?.run;

      if (!run) {
        throw new Error(`Unknown local gateway run: ${input.runId}`);
      }

      const nextRun = applyAIProposal(run, input.proposalId);
      const nextEntry = entry ?? {
        input: runStore.get(input.runId)?.input ?? ({} as AIRunInput),
        run,
      };
      runStore.set(input.runId, {
        ...nextEntry,
        finalRun: nextRun,
      });

      return cloneRun(nextRun);
    },
  };
}
