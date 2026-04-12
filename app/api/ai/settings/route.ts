import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getAISettingsPayload, saveAIProviderSettings, saveUserAISettings } from "@/lib/ai/chat-store";

const providerUpdateSchema = z.object({
  id: z.enum(["openrouter", "zai", "openai"]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  enabled: z.boolean().optional(),
  models: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  providers: z.array(providerUpdateSchema).optional(),
  selectedProvider: z.enum(["openrouter", "zai", "openai", "local"]).optional(),
  selectedModel: z.string().optional(),
  features: z
    .object({
      projectAssistant: z.boolean().optional(),
      taskSuggestions: z.boolean().optional(),
      riskAnalysis: z.boolean().optional(),
      budgetForecast: z.boolean().optional(),
    })
    .optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "RUN_AI_ACTIONS",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const payload = await getAISettingsPayload(
      authResult.accessProfile.userId,
      authResult.workspace.id
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "RUN_AI_ACTIONS",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    if (parsed.data.providers && parsed.data.providers.length > 0) {
      await saveAIProviderSettings(parsed.data.providers);
    }

    await saveUserAISettings(authResult.accessProfile.userId, {
      selectedProvider: parsed.data.selectedProvider,
      selectedModel: parsed.data.selectedModel,
      features: parsed.data.features,
    });

    const payload = await getAISettingsPayload(
      authResult.accessProfile.userId,
      authResult.workspace.id
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
