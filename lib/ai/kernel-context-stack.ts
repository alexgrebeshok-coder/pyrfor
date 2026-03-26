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

export interface KernelChatContextInput extends AIChatContextInput {
  includeMessages?: boolean;
}

export interface KernelChatContextAssemblyMeta {
  source: "live" | "mock";
  scope: "portfolio" | "project";
  projectId: string | null;
  memoryCount: number;
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
  const messages =
    input.includeMessages === false
      ? undefined
      : buildAIChatMessages(input.messages, bundle);

  return {
    bundle,
    ...(messages ? { messages } : {}),
    assembly: {
      source: assembled.source,
      scope: assembled.scope,
      projectId: assembled.projectId,
      memoryCount: assembled.memory.length,
      issueCount: assembled.issues.length,
      issues: assembled.issues,
    },
  };
}
