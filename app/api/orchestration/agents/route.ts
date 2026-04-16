/**
 * Orchestration Agents API — list & create agents
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { listAgents, createAgent } from "@/lib/orchestration/agent-service";
import { getErrorMessage, hasErrorCode } from "@/lib/orchestration/error-utils";
import { isAgentStatus } from "@/lib/orchestration/types";

// GET /api/orchestration/agents — list agents in workspace
export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const workspaceId =
      req.nextUrl.searchParams.get("workspaceId") ?? "executive";
    const statusParam = req.nextUrl.searchParams.get("status") ?? undefined;
    if (statusParam && !isAgentStatus(statusParam)) {
      return NextResponse.json({ error: "Invalid agent status filter" }, { status: 400 });
    }
    const status = statusParam && isAgentStatus(statusParam) ? statusParam : undefined;

    const agents = await listAgents(workspaceId, {
      status,
      includeState: true,
    });

    return NextResponse.json({ agents });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list agents") },
      { status: 500 }
    );
  }
}

// POST /api/orchestration/agents — create a new agent
export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const {
      workspaceId = "executive",
      name,
      slug,
      definitionId,
      role,
      reportsToId,
      adapterType,
      adapterConfig,
      runtimeConfig,
      budgetMonthlyCents,
      permissions,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const agent = await createAgent({
      workspaceId,
      name,
      slug: slug || name.toLowerCase().replace(/\s+/g, "-"),
      definitionId,
      role,
      reportsToId,
      adapterType,
      adapterConfig,
      runtimeConfig,
      budgetMonthlyCents,
      permissions,
    });

    return NextResponse.json({ agent }, { status: 201 });
  } catch (error: unknown) {
    if (hasErrorCode(error, "P2002")) {
      return NextResponse.json(
        { error: "Agent with this slug already exists in workspace" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create agent") },
      { status: 500 }
    );
  }
}
