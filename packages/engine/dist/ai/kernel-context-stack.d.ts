import { type AIChatContextBundle, type AIChatContextInput, type AIChatMessage } from './context-builder';
import { type ContextAssemblerIssue } from './context-assembler';
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
export declare function buildKernelChatContext(input: KernelChatContextInput): Promise<KernelChatContextResult>;
//# sourceMappingURL=kernel-context-stack.d.ts.map