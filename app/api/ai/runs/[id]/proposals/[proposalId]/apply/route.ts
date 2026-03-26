import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { applyServerAIProposal } from "@/lib/ai/server-runs";
import { syncEscalationQueue } from "@/lib/escalations";
import { badRequest, jsonError } from "@/lib/server/api-utils";
import { evaluatePilotWorkflowAccess } from "@/lib/server/pilot-controls";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; proposalId: string }>;
  }
) {
  const authResult = await authorizeRequest(request, {
    permission: "REVIEW_WORK_REPORTS",
    workspaceId: "delivery",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const pilotAccess = evaluatePilotWorkflowAccess({
    accessProfile: authResult.accessProfile,
    runtime: getServerRuntimeState(),
    workflow: "ai_apply",
  });
  if (!pilotAccess.allowed) {
    return jsonError(
      403,
      pilotAccess.code ?? "PILOT_STAGE_BLOCKED",
      pilotAccess.message ?? "AI apply is blocked by pilot controls."
    );
  }

  try {
    const { id, proposalId } = await params;
    const run = await applyServerAIProposal({
      runId: id,
      proposalId,
      operatorId: authResult.accessProfile.userId,
    });
    void syncEscalationQueue().catch((error) => {
      console.error("Failed to sync escalation queue after AI proposal apply.", error);
    });
    return NextResponse.json(run);
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Failed to apply AI action.",
      "AI_PROPOSAL_APPLY_FAILED"
    );
  }
}
