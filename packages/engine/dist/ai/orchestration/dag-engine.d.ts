/**
 * DAG-Based Workflow Engine
 *
 * Executes multi-agent workflows as Directed Acyclic Graphs (DAG).
 * Inspired by LangGraph — each node is an agent invocation, edges define dependencies.
 *
 * Features:
 * - Parallel execution of independent nodes
 * - State passing between nodes (output of A → input of B)
 * - Conditional branching (gate functions)
 * - Retry with backoff
 * - Execution tracing
 *
 * Use cases:
 * - Complex analysis: Risk → Budget → Summary (sequential)
 * - Portfolio review: [Risk + Budget + Quality] → Director (parallel → merge)
 * - Conditional: if risk_score > 8 → escalate else → summarize
 */
import { getRouter } from '../providers';
export interface WorkflowNode {
    id: string;
    /** Agent ID or "system" for non-AI nodes */
    agentId: string;
    /** System prompt for this node */
    systemPrompt: string;
    /** User prompt template — use {{prev}} for previous node output, {{input}} for workflow input */
    promptTemplate: string;
    /** Dependencies — list of node IDs that must complete first */
    dependencies: string[];
    /** Optional gate: only execute if this function returns true */
    gate?: (state: WorkflowState) => boolean;
    /** Retry config */
    retry?: {
        maxAttempts: number;
        backoffMs: number;
    };
    /** Override provider for this node */
    provider?: string;
    model?: string;
    timeoutMs?: number;
}
export interface WorkflowDefinition {
    id: string;
    name: string;
    description?: string;
    nodes: WorkflowNode[];
    /** The final node(s) whose output becomes the workflow result */
    outputNodes: string[];
}
export interface NodeResult {
    nodeId: string;
    agentId: string;
    output: string;
    durationMs: number;
    attempts: number;
    status: "success" | "failed" | "skipped";
    error?: string;
}
export interface WorkflowState {
    workflowId: string;
    input: string;
    context?: string;
    nodeResults: Map<string, NodeResult>;
    startedAt: Date;
}
export interface WorkflowResult {
    workflowId: string;
    status: "completed" | "failed" | "partial";
    output: string;
    nodeResults: NodeResult[];
    durationMs: number;
    nodeCount: number;
}
export declare function executeWorkflow(definition: WorkflowDefinition, input: string, options?: {
    context?: string;
    provider?: string;
    model?: string;
    router?: ReturnType<typeof getRouter>;
}): Promise<WorkflowResult>;
export declare const PORTFOLIO_REVIEW_WORKFLOW: WorkflowDefinition;
export declare const PROJECT_DEEP_DIVE_WORKFLOW: WorkflowDefinition;
//# sourceMappingURL=dag-engine.d.ts.map