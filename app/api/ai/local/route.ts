import { NextRequest, NextResponse } from "next/server";

import { AUTO_AGENT_ID, getAgentById } from "@/lib/ai/agents";
import { resolveAgentId } from "@/lib/ai/auto-routing";
import { invokeOpenClawGateway } from "@/lib/ai/openclaw-gateway";
import { hasOpenClawGateway, getServerAIStatus } from "@/lib/ai/server-runs";
import type { AIContextSnapshot, AIRunInput } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildLocalContext(projectId?: string): AIContextSnapshot {
  const activeContext = projectId
    ? {
        type: "project" as const,
        pathname: `/projects/${projectId}`,
        title: `Project ${projectId}`,
        subtitle: "Local gateway context.",
        projectId,
      }
    : {
        type: "portfolio" as const,
        pathname: "/ai/local",
        title: "Local AI test",
        subtitle: "Local gateway context.",
      };

  return {
    locale: "ru",
    interfaceLocale: "ru",
    generatedAt: new Date().toISOString(),
    activeContext,
    projects: [],
    tasks: [],
    team: [],
    risks: [],
    notifications: [],
  };
}

function resolveLocalAgent(message: string, context: AIContextSnapshot, requestedAgentId?: string) {
  const agentId = resolveAgentId(requestedAgentId ?? AUTO_AGENT_ID, context, message);
  return getAgentById(agentId) ?? getAgentById("portfolio-analyst") ?? null;
}

export async function GET() {
  const status = getServerAIStatus();

  return NextResponse.json({
    success: true,
    configured: hasOpenClawGateway(),
    aiStatus: status,
    message:
      status.mode === "gateway"
        ? "Local gateway is available."
        : "Local gateway is not configured. Set OPENCLAW_GATEWAY_URL to enable a browser/runtime local endpoint.",
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!hasOpenClawGateway()) {
      return NextResponse.json(
        {
          success: false,
          error: "Local gateway is not configured.",
          code: "LOCAL_GATEWAY_DISABLED",
        },
        { status: 503 }
      );
    }

    const body = (await req.json()) as {
      message?: string;
      projectId?: string;
      agentId?: string;
    };

    if (!body.message?.trim()) {
      return NextResponse.json(
        { success: false, error: "Message is required." },
        { status: 400 }
      );
    }

    const context = buildLocalContext(body.projectId);
    const agent = resolveLocalAgent(body.message, context, body.agentId);

    if (!agent) {
      return NextResponse.json(
        { success: false, error: "No agent is available for the requested local run." },
        { status: 503 }
      );
    }

    const runId = `local-ai-${crypto.randomUUID()}`;
    const result = await invokeOpenClawGateway(
      {
        agent,
        prompt: body.message.trim(),
        context,
        source: {
          workflow: "local_gateway_test",
          purpose: "local_gateway",
          entityType: context.activeContext.type,
          entityId: context.activeContext.projectId ?? context.activeContext.pathname,
          entityLabel: context.activeContext.title,
          projectId: context.activeContext.projectId,
        },
      } satisfies AIRunInput,
      runId
    );

    return NextResponse.json({
      success: true,
      runId,
      aiStatus: getServerAIStatus(),
      result,
      response: result.summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
