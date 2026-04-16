import { NextRequest, NextResponse } from "next/server";

import { AGENT_PRESETS, getPreset } from "@/lib/orchestration/agent-presets";
import { resolveActor, requireUser } from "@/lib/orchestration/actor";
import { createAgent } from "@/lib/orchestration/agent-service";

/**
 * GET /api/orchestration/templates — list all presets
 */
export async function GET() {
  return NextResponse.json({
    presets: AGENT_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      nameRu: p.nameRu,
      role: p.role,
      description: p.description,
      descriptionRu: p.descriptionRu,
      suggestedSchedule: p.suggestedSchedule,
      suggestedBudgetCents: p.suggestedBudgetCents,
    })),
  });
}

/**
 * POST /api/orchestration/templates — create agent from preset
 * Body: { presetId, workspaceId, overrides?: { name?, schedule?, budgetMonthlyCents? } }
 */
export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);
  const { presetId, workspaceId, overrides = {} } = await req.json();

  if (!presetId || !workspaceId) {
    return NextResponse.json({ error: "presetId and workspaceId required" }, { status: 400 });
  }

  const preset = getPreset(presetId);
  if (!preset) {
    return NextResponse.json({ error: `Unknown preset: ${presetId}` }, { status: 404 });
  }

  const agent = await createAgent({
    workspaceId,
    definitionId: preset.definitionId,
    name: overrides.name ?? preset.name,
    slug: `${preset.id}-${Date.now().toString(36)}`,
    role: preset.role,
    adapterType: "internal",
    budgetMonthlyCents: overrides.budgetMonthlyCents ?? preset.suggestedBudgetCents,
    runtimeConfig: {
      schedule: overrides.schedule ?? preset.suggestedSchedule,
      systemPromptSuffix: preset.systemPromptSuffix,
    },
    permissions: preset.permissions,
  });

  return NextResponse.json({ agent }, { status: 201 });
}
