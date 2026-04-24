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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../../observability/logger';
import { getRouter } from '../providers';
// ============================================
// Template engine
// ============================================
function renderTemplate(template, state, deps) {
    let result = template;
    // {{input}} → workflow input
    result = result.replace(/\{\{input\}\}/g, state.input);
    // {{prev}} → concatenated output of dependencies
    const depOutputs = deps
        .map((depId) => state.nodeResults.get(depId))
        .filter((r) => !!r && r.status === "success")
        .map((r) => `[${r.agentId}]: ${r.output}`)
        .join("\n\n");
    result = result.replace(/\{\{prev\}\}/g, depOutputs || state.input);
    // {{nodeId}} → specific node output
    result = result.replace(/\{\{([\w-]+)\}\}/g, (_, nodeId) => {
        var _a, _b;
        return (_b = (_a = state.nodeResults.get(nodeId)) === null || _a === void 0 ? void 0 : _a.output) !== null && _b !== void 0 ? _b : "";
    });
    return result;
}
// ============================================
// Topological sort
// ============================================
function topologicalSort(nodes) {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const remaining = new Set(nodes.map((n) => n.id));
    const completed = new Set();
    const layers = [];
    while (remaining.size > 0) {
        const ready = Array.from(remaining)
            .map((id) => nodeMap.get(id))
            .filter((n) => n.dependencies.every((dep) => completed.has(dep)));
        if (ready.length === 0) {
            const cycleNodes = Array.from(remaining).map((id) => {
                const node = nodeMap.get(id);
                const deps = node.dependencies.filter((dep) => remaining.has(dep));
                return `${id} -> [${deps.join(", ")}]`;
            });
            throw new Error(`DAG has circular dependencies: ${cycleNodes.join("; ")}`);
        }
        layers.push(ready);
        for (const node of ready) {
            remaining.delete(node.id);
            completed.add(node.id);
        }
    }
    return layers;
}
// ============================================
// Node executor
// ============================================
function executeNode(node, state, router) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const start = Date.now();
        const maxAttempts = (_b = (_a = node.retry) === null || _a === void 0 ? void 0 : _a.maxAttempts) !== null && _b !== void 0 ? _b : 1;
        const backoffMs = (_d = (_c = node.retry) === null || _c === void 0 ? void 0 : _c.backoffMs) !== null && _d !== void 0 ? _d : 1000;
        try {
            if (node.gate && !node.gate(state)) {
                return {
                    nodeId: node.id,
                    agentId: node.agentId,
                    output: "",
                    durationMs: 0,
                    attempts: 0,
                    status: "skipped",
                };
            }
        }
        catch (err) {
            return {
                nodeId: node.id,
                agentId: node.agentId,
                output: "",
                durationMs: Date.now() - start,
                attempts: 0,
                status: "failed",
                error: `Gate failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        const prompt = renderTemplate(node.promptTemplate, state, node.dependencies);
        const messages = [
            { role: "system", content: node.systemPrompt },
            { role: "user", content: prompt },
        ];
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const timeoutMs = (_e = node.timeoutMs) !== null && _e !== void 0 ? _e : 30000;
            let timeoutHandle;
            try {
                const output = yield new Promise((resolve, reject) => {
                    let settled = false;
                    timeoutHandle = setTimeout(() => {
                        if (settled)
                            return;
                        settled = true;
                        reject(new Error(`Node timeout after ${timeoutMs}ms`));
                    }, timeoutMs);
                    router
                        .chat(messages, {
                        provider: node.provider,
                        model: node.model,
                        agentId: node.agentId,
                        runId: state.workflowId,
                    })
                        .then((value) => {
                        if (settled)
                            return;
                        settled = true;
                        if (timeoutHandle)
                            clearTimeout(timeoutHandle);
                        resolve(value);
                    })
                        .catch((err) => {
                        if (settled)
                            return;
                        settled = true;
                        if (timeoutHandle)
                            clearTimeout(timeoutHandle);
                        reject(err instanceof Error ? err : new Error(String(err)));
                    });
                });
                return {
                    nodeId: node.id,
                    agentId: node.agentId,
                    output,
                    durationMs: Date.now() - start,
                    attempts: attempt,
                    status: "success",
                };
            }
            catch (err) {
                if (timeoutHandle)
                    clearTimeout(timeoutHandle);
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn("dag: node execution failed", { nodeId: node.id, attempt, error: msg });
                if (attempt < maxAttempts) {
                    yield new Promise((r) => setTimeout(r, backoffMs * attempt));
                }
                else {
                    return {
                        nodeId: node.id,
                        agentId: node.agentId,
                        output: "",
                        durationMs: Date.now() - start,
                        attempts: attempt,
                        status: "failed",
                        error: msg,
                    };
                }
            }
        }
        return {
            nodeId: node.id,
            agentId: node.agentId,
            output: "",
            durationMs: 0,
            attempts: 0,
            status: "failed",
            error: "unreachable",
        };
    });
}
// ============================================
// Workflow executor
// ============================================
export function executeWorkflow(definition_1, input_1) {
    return __awaiter(this, arguments, void 0, function* (definition, input, options = {}) {
        var _a;
        const start = Date.now();
        const router = (_a = options.router) !== null && _a !== void 0 ? _a : getRouter();
        const state = {
            workflowId: `wf_${definition.id}_${Date.now()}`,
            input,
            context: options.context,
            nodeResults: new Map(),
            startedAt: new Date(),
        };
        logger.info("dag: workflow started", {
            id: definition.id,
            name: definition.name,
            nodes: definition.nodes.length,
        });
        let allSucceeded = true;
        try {
            validateWorkflowDefinition(definition);
            const layers = topologicalSort(definition.nodes);
            const failedNodes = new Set();
            for (const layer of layers) {
                const runnable = [];
                for (const node of layer) {
                    const failedDeps = node.dependencies.filter((dep) => failedNodes.has(dep));
                    if (failedDeps.length > 0) {
                        const skipResult = {
                            nodeId: node.id,
                            agentId: node.agentId,
                            output: "",
                            durationMs: 0,
                            attempts: 0,
                            status: "skipped",
                            error: `Dependency failed: ${failedDeps.join(", ")}`,
                        };
                        state.nodeResults.set(skipResult.nodeId, skipResult);
                        allSucceeded = false;
                        continue;
                    }
                    runnable.push(node);
                }
                // Execute all runnable nodes in this layer in parallel, isolating failures
                const settled = yield Promise.allSettled(runnable.map((node) => executeNode(node, state, router)));
                for (let i = 0; i < settled.length; i += 1) {
                    const outcome = settled[i];
                    const node = runnable[i];
                    const result = outcome.status === "fulfilled"
                        ? outcome.value
                        : {
                            nodeId: node.id,
                            agentId: node.agentId,
                            output: "",
                            durationMs: 0,
                            attempts: 0,
                            status: "failed",
                            error: outcome.reason instanceof Error
                                ? outcome.reason.message
                                : String(outcome.reason),
                        };
                    state.nodeResults.set(result.nodeId, result);
                    if (result.status === "failed") {
                        allSucceeded = false;
                        failedNodes.add(result.nodeId);
                    }
                }
            }
        }
        catch (err) {
            logger.error("dag: workflow execution error", {
                id: definition.id,
                error: err instanceof Error ? err.message : String(err),
            });
            allSucceeded = false;
        }
        // Collect output from output nodes
        const outputParts = definition.outputNodes
            .map((nodeId) => state.nodeResults.get(nodeId))
            .filter((r) => !!r && r.status === "success")
            .map((r) => r.output);
        const output = outputParts.join("\n\n---\n\n");
        const nodeResults = Array.from(state.nodeResults.values());
        const result = {
            workflowId: state.workflowId,
            status: allSucceeded ? "completed" : outputParts.length > 0 ? "partial" : "failed",
            output,
            nodeResults,
            durationMs: Date.now() - start,
            nodeCount: definition.nodes.length,
        };
        logger.info("dag: workflow completed", {
            id: definition.id,
            status: result.status,
            durationMs: result.durationMs,
            nodes: nodeResults.length,
        });
        return result;
    });
}
// ============================================
// Built-in workflow definitions
// ============================================
export const PORTFOLIO_REVIEW_WORKFLOW = {
    id: "portfolio_review",
    name: "Portfolio Review",
    description: "Comprehensive portfolio analysis with parallel risk, budget, and quality checks",
    nodes: [
        {
            id: "risk_analysis",
            agentId: "risk-researcher",
            systemPrompt: "You are a Risk Researcher. Identify and assess risks in the given portfolio context.",
            promptTemplate: "Analyze risks for the following:\n\n{{input}}",
            dependencies: [],
            retry: { maxAttempts: 2, backoffMs: 1000 },
        },
        {
            id: "budget_analysis",
            agentId: "budget-controller",
            systemPrompt: "You are a Budget Controller. Analyze financial health and cost variances.",
            promptTemplate: "Review budget and financial status for:\n\n{{input}}",
            dependencies: [],
            retry: { maxAttempts: 2, backoffMs: 1000 },
        },
        {
            id: "synthesis",
            agentId: "pmo-director",
            systemPrompt: "You are the PMO Director. Synthesize risk and financial analyses into an executive summary with clear action items.",
            promptTemplate: "Create an executive portfolio review based on these analyses:\n\n{{prev}}\n\nOriginal context:\n{{input}}",
            dependencies: ["risk_analysis", "budget_analysis"],
        },
    ],
    outputNodes: ["synthesis"],
};
export const PROJECT_DEEP_DIVE_WORKFLOW = {
    id: "project_deep_dive",
    name: "Project Deep Dive",
    description: "In-depth project analysis with execution planning and risk assessment",
    nodes: [
        {
            id: "risk_scan",
            agentId: "risk-researcher",
            systemPrompt: "Identify project risks, blockers, and failure modes.",
            promptTemplate: "Scan for risks in this project:\n\n{{input}}",
            dependencies: [],
        },
        {
            id: "execution_plan",
            agentId: "execution-planner",
            systemPrompt: "Create a detailed execution plan with tasks, owners, and deadlines.",
            promptTemplate: "Create execution plan for:\n\n{{input}}",
            dependencies: [],
        },
        {
            id: "integrated_report",
            agentId: "status-reporter",
            systemPrompt: "Write an integrated project status report combining risk and execution insights.",
            promptTemplate: "Write a comprehensive project report using:\n\nRisk Analysis:\n{{risk_scan}}\n\nExecution Plan:\n{{execution_plan}}\n\nContext:\n{{input}}",
            dependencies: ["risk_scan", "execution_plan"],
        },
    ],
    outputNodes: ["integrated_report"],
};
function validateWorkflowDefinition(definition) {
    const nodeIds = new Set(definition.nodes.map((node) => node.id));
    const missingOutputs = definition.outputNodes.filter((nodeId) => !nodeIds.has(nodeId));
    if (missingOutputs.length > 0) {
        throw new Error(`Output nodes not found: ${missingOutputs.join(", ")}`);
    }
}
