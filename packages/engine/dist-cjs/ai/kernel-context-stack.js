"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildKernelChatContext = buildKernelChatContext;
const context_builder_1 = require("./context-builder");
const context_assembler_1 = require("./context-assembler");
const agent_memory_store_1 = require("./memory/agent-memory-store");
const document_indexer_1 = require("./rag/document-indexer");
async function buildKernelChatContext(input) {
    const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const assembled = await (0, context_assembler_1.assembleContext)({
        projectId: input.projectId,
        locale: input.locale,
        includeEvidence: Boolean(input.projectId),
        includeMemory: true,
    });
    const bundle = await (0, context_builder_1.buildAIChatContextBundle)({
        messages: input.messages,
        projectId: input.projectId,
        locale: input.locale,
    }, {
        loadSnapshot: async () => assembled.snapshot,
        ...(assembled.evidence
            ? {
                loadEvidence: async () => assembled.evidence,
            }
            : {}),
    });
    const memoryContext = input.agentId && latestUserMessage.trim()
        ? await (0, agent_memory_store_1.buildMemoryContext)(input.agentId, latestUserMessage, {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            limit: 5,
        })
        : "";
    const ragContext = input.projectId && latestUserMessage.trim()
        ? await (0, document_indexer_1.buildRAGContext)(latestUserMessage, {
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            limit: 5,
        })
        : "";
    const enrichedBundle = memoryContext || ragContext
        ? {
            ...bundle,
            systemPrompt: [bundle.systemPrompt, memoryContext, ragContext]
                .filter((section) => section.trim().length > 0)
                .join("\n\n"),
        }
        : bundle;
    const messages = input.includeMessages === false
        ? undefined
        : (0, context_builder_1.buildAIChatMessages)(input.messages, enrichedBundle);
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
