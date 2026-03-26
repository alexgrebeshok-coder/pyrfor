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

import { logger } from "@/lib/logger";
import { getRouter } from "@/lib/ai/providers";
import type { Message } from "@/lib/ai/providers";

// ============================================
// DAG Types
// ============================================

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
  retry?: { maxAttempts: number; backoffMs: number };
  /** Override provider for this node */
  provider?: string;
  model?: string;
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

// ============================================
// Template engine
// ============================================

function renderTemplate(
  template: string,
  state: WorkflowState,
  deps: string[]
): string {
  let result = template;

  // {{input}} → workflow input
  result = result.replace(/\{\{input\}\}/g, state.input);

  // {{prev}} → concatenated output of dependencies
  const depOutputs = deps
    .map((depId) => state.nodeResults.get(depId))
    .filter((r): r is NodeResult => !!r && r.status === "success")
    .map((r) => `[${r.agentId}]: ${r.output}`)
    .join("\n\n");
  result = result.replace(/\{\{prev\}\}/g, depOutputs || state.input);

  // {{nodeId}} → specific node output
  result = result.replace(/\{\{(\w+)\}\}/g, (_, nodeId) => {
    return state.nodeResults.get(nodeId)?.output ?? "";
  });

  return result;
}

// ============================================
// Topological sort
// ============================================

function topologicalSort(nodes: WorkflowNode[]): WorkflowNode[][] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const remaining = new Set(nodes.map((n) => n.id));
  const completed = new Set<string>();
  const layers: WorkflowNode[][] = [];

  while (remaining.size > 0) {
    const ready = Array.from(remaining)
      .map((id) => nodeMap.get(id)!)
      .filter((n) => n.dependencies.every((dep) => completed.has(dep)));

    if (ready.length === 0) {
      throw new Error("DAG has circular dependencies");
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

async function executeNode(
  node: WorkflowNode,
  state: WorkflowState,
  router: ReturnType<typeof getRouter>
): Promise<NodeResult> {
  const start = Date.now();
  const maxAttempts = node.retry?.maxAttempts ?? 1;
  const backoffMs = node.retry?.backoffMs ?? 1000;

  // Gate check
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

  const prompt = renderTemplate(node.promptTemplate, state, node.dependencies);
  const messages: Message[] = [
    { role: "system", content: node.systemPrompt },
    { role: "user", content: prompt },
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const output = await router.chat(messages, {
        provider: node.provider,
        model: node.model,
        agentId: node.agentId,
        runId: state.workflowId,
      });

      return {
        nodeId: node.id,
        agentId: node.agentId,
        output,
        durationMs: Date.now() - start,
        attempts: attempt,
        status: "success",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("dag: node execution failed", { nodeId: node.id, attempt, error: msg });

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      } else {
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
}

// ============================================
// Workflow executor
// ============================================

export async function executeWorkflow(
  definition: WorkflowDefinition,
  input: string,
  options: { context?: string; provider?: string; model?: string } = {}
): Promise<WorkflowResult> {
  const start = Date.now();
  const router = getRouter();

  const state: WorkflowState = {
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
    const layers = topologicalSort(definition.nodes);

    for (const layer of layers) {
      // Execute all nodes in this layer in parallel
      const results = await Promise.all(
        layer.map((node) => executeNode(node, state, router))
      );

      for (const result of results) {
        state.nodeResults.set(result.nodeId, result);
        if (result.status === "failed") allSucceeded = false;
      }
    }
  } catch (err) {
    logger.error("dag: workflow execution error", {
      id: definition.id,
      error: err instanceof Error ? err.message : String(err),
    });
    allSucceeded = false;
  }

  // Collect output from output nodes
  const outputParts = definition.outputNodes
    .map((nodeId) => state.nodeResults.get(nodeId))
    .filter((r): r is NodeResult => !!r && r.status === "success")
    .map((r) => r.output);

  const output = outputParts.join("\n\n---\n\n");
  const nodeResults = Array.from(state.nodeResults.values());

  const result: WorkflowResult = {
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
}

// ============================================
// Built-in workflow definitions
// ============================================

export const PORTFOLIO_REVIEW_WORKFLOW: WorkflowDefinition = {
  id: "portfolio_review",
  name: "Portfolio Review",
  description: "Comprehensive portfolio analysis with parallel risk, budget, and quality checks",
  nodes: [
    {
      id: "risk_analysis",
      agentId: "risk-researcher",
      systemPrompt:
        "You are a Risk Researcher. Identify and assess risks in the given portfolio context.",
      promptTemplate: "Analyze risks for the following:\n\n{{input}}",
      dependencies: [],
      retry: { maxAttempts: 2, backoffMs: 1000 },
    },
    {
      id: "budget_analysis",
      agentId: "budget-controller",
      systemPrompt:
        "You are a Budget Controller. Analyze financial health and cost variances.",
      promptTemplate: "Review budget and financial status for:\n\n{{input}}",
      dependencies: [],
      retry: { maxAttempts: 2, backoffMs: 1000 },
    },
    {
      id: "synthesis",
      agentId: "pmo-director",
      systemPrompt:
        "You are the PMO Director. Synthesize risk and financial analyses into an executive summary with clear action items.",
      promptTemplate:
        "Create an executive portfolio review based on these analyses:\n\n{{prev}}\n\nOriginal context:\n{{input}}",
      dependencies: ["risk_analysis", "budget_analysis"],
    },
  ],
  outputNodes: ["synthesis"],
};

export const PROJECT_DEEP_DIVE_WORKFLOW: WorkflowDefinition = {
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
      promptTemplate:
        "Write a comprehensive project report using:\n\nRisk Analysis:\n{{risk_scan}}\n\nExecution Plan:\n{{execution_plan}}\n\nContext:\n{{input}}",
      dependencies: ["risk_scan", "execution_plan"],
    },
  ],
  outputNodes: ["integrated_report"],
};
