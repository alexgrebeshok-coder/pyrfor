import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  isValidationError,
  requiredJsonBodyOptions,
  validateBody,
} from "@/lib/server/api-validation";
import {
  createTenantOnboardingRunbook,
  getTenantOnboardingOverview,
} from "@/lib/tenant-onboarding";
import {
  databaseUnavailable,
  parseOptionalInteger,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { createTenantOnboardingRunbookSchema } from "@/lib/validators/tenant-onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_CONNECTORS",
    workspaceId: "executive",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtimeState = getServerRuntimeState();
    const limit = parseOptionalInteger(request.nextUrl.searchParams.get("limit")) ?? 8;
    const overview = await getTenantOnboardingOverview({
      accessProfile: authResult.accessProfile,
      includePersistedState: runtimeState.databaseConfigured,
      runbookLimit: limit,
    });

    return NextResponse.json(overview);
  } catch (error) {
    return serverError(
      error,
      "Failed to load tenant onboarding overview.",
      "TENANT_ONBOARDING_OVERVIEW_FAILED"
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_CONNECTORS",
    workspaceId: "executive",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtimeState = getServerRuntimeState();
    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const parsed = await validateBody(
      request,
      createTenantOnboardingRunbookSchema,
      requiredJsonBodyOptions
    );
    if (isValidationError(parsed)) {
      return parsed;
    }

    const created = await createTenantOnboardingRunbook(parsed, {
      accessProfile: authResult.accessProfile,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return serverError(
      error,
      "Failed to create tenant onboarding runbook.",
      "TENANT_ONBOARDING_CREATE_FAILED"
    );
  }
}
