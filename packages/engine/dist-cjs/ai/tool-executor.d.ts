/**
 * AI Tool Executor — thin dispatcher over canonical tool domain services
 */
import type { AIToolCall, AIToolResult } from "./tools";
export declare function executeToolCall(call: AIToolCall): Promise<AIToolResult>;
export declare function executeToolCalls(calls: AIToolCall[]): Promise<AIToolResult[]>;
//# sourceMappingURL=tool-executor.d.ts.map