var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { buildAIChatContextBundle, buildAIChatMessages, } from './context-builder';
import { assembleContext, } from './context-assembler';
import { buildMemoryContext } from './memory/agent-memory-store';
import { buildRAGContext } from './rag/document-indexer';
export function buildKernelChatContext(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const latestUserMessage = (_b = (_a = [...input.messages].reverse().find((message) => message.role === "user")) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : "";
        const assembled = yield assembleContext({
            projectId: input.projectId,
            locale: input.locale,
            includeEvidence: Boolean(input.projectId),
            includeMemory: true,
        });
        const bundle = yield buildAIChatContextBundle({
            messages: input.messages,
            projectId: input.projectId,
            locale: input.locale,
        }, Object.assign({ loadSnapshot: () => __awaiter(this, void 0, void 0, function* () { return assembled.snapshot; }) }, (assembled.evidence
            ? {
                loadEvidence: () => __awaiter(this, void 0, void 0, function* () { return assembled.evidence; }),
            }
            : {})));
        const memoryContext = input.agentId && latestUserMessage.trim()
            ? yield buildMemoryContext(input.agentId, latestUserMessage, {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                limit: 5,
            })
            : "";
        const ragContext = input.projectId && latestUserMessage.trim()
            ? yield buildRAGContext(latestUserMessage, {
                projectId: input.projectId,
                workspaceId: input.workspaceId,
                limit: 5,
            })
            : "";
        const enrichedBundle = memoryContext || ragContext
            ? Object.assign(Object.assign({}, bundle), { systemPrompt: [bundle.systemPrompt, memoryContext, ragContext]
                    .filter((section) => section.trim().length > 0)
                    .join("\n\n") }) : bundle;
        const messages = input.includeMessages === false
            ? undefined
            : buildAIChatMessages(input.messages, enrichedBundle);
        return Object.assign(Object.assign({ bundle: enrichedBundle }, (messages ? { messages } : {})), { assembly: {
                source: assembled.source,
                scope: assembled.scope,
                projectId: assembled.projectId,
                memoryCount: assembled.memory.length,
                agentMemoryInjected: Boolean(memoryContext),
                ragInjected: Boolean(ragContext),
                issueCount: assembled.issues.length,
                issues: assembled.issues,
            } });
    });
}
