import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { analyzeEvidenceRecord } from "@/lib/evidence";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import { notFound, serverError } from "@/lib/server/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analyzeEvidenceSchema = z.object({
  recordId: z.string().trim().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "VIEW_CONNECTORS",
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const parsed = await validateBody(request, analyzeEvidenceSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const analysis = await analyzeEvidenceRecord(parsed.recordId);

    if (!analysis) {
      return notFound(`Unknown evidence record: ${parsed.recordId}`);
    }

    return NextResponse.json(analysis);
  } catch (error) {
    return serverError(error, "Failed to analyze evidence.", "EVIDENCE_ANALYSIS_FAILED");
  }
}
