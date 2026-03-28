import {
  buildAIChatContextBundle,
  buildAIChatMessages,
  type AIChatContextBundle,
  type AIChatContextInput,
  type AIChatMessage,
} from "@/lib/ai/context-builder";
import {
  assembleContext,
  type ContextAssemblerIssue,
} from "@/lib/ai/context-assembler";
import { buildMemoryContext } from "@/lib/ai/memory/agent-memory-store";
import { buildRAGContext } from "@/lib/ai/rag/document-indexer";

export interface KernelChatContextInput extends AIChatContextInput {
  includeMessages?: boolean;
  agentId?: string;
  workspaceId?: string;
}

export interface KernelChatContextAssemblyMeta {
  source: "live" | "mock";
  scope: "portfolio" | "project";
  projectId: string | null;
  memoryCount: number;
  agentMemoryInjected: boolean;
  ragInjected: boolean;
  issueCount: number;
  issues: ContextAssemblerIssue[];
}

export interface KernelChatContextResult {
  bundle: AIChatContextBundle;
  messages?: AIChatMessage[];
  assembly: KernelChatContextAssemblyMeta;
}

export async function buildKernelChatContext(
  input: KernelChatContextInput
): Promise<KernelChatContextResult> {
  const latestUserMessage =
    [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const assembled = await assembleContext({
    projectId: input.projectId,
    locale: input.locale,
    includeEvidence: Boolean(input.projectId),
    includeMemory: true,
  });
  const bundle = await buildAIChatContextBundle(
    {
      messages: input.messages,
      projectId: input.projectId,
      locale: input.locale,
    },
    {
      loadSnapshot: async () => assembled.snapshot,
      ...(assembled.evidence
        ? {
            loadEvidence: async () => assembled.evidence!,
          }
        : {}),
    }
  );
  const memoryContext =
    input.agentId && latestUserMessage.trim()
      ? await buildMemoryContext(input.agentId, latestUserMessage, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          limit: 5,
        })
      : "";
  const ragContext =
    input.projectId && latestUserMessage.trim()
      ? await buildRAGContext(latestUserMessage, {
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          limit: 5,
        })
      : "";
  const enrichedBundle: AIChatContextBundle =
    memoryContext || ragContext
      ? {
          ...bundle,
          systemPrompt: [bundle.systemPrompt, memoryContext, ragContext]
            .filter((section) => section.trim().length > 0)
            .join("\n\n"),
        }
      : bundle;
  const messages =
    input.includeMessages === false
      ? undefined
      : buildAIChatMessages(input.messages, enrichedBundle);

  return {
    bundle: enrichedBundle,
    ...(messages ? { messages } : {}),
    assembly: {
      source: assembled.source,
      scope: assembled.scope,
      projectId: assembled.projectId,
      memoryCount: assembled.memory.length,
      agentMemoryInjected: Boolean(memoryContext),
      ragInjected: Boolean(ragContext),
      issueCount: assembled.issues.length,
      issues: assembled.issues,
    },
  };
}
