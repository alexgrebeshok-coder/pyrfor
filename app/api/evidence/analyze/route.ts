import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { analyzeEvidenceRecord } from "@/lib/evidence";
import { notFound, serverError, validationError } from "@/lib/server/api-utils";

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

    const body = await request.json();
    const parsed = analyzeEvidenceSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const analysis = await analyzeEvidenceRecord(parsed.data.recordId);

    if (!analysis) {
      return notFound(`Unknown evidence record: ${parsed.data.recordId}`);
    }

    return NextResponse.json(analysis);
  } catch (error) {
    return serverError(error, "Failed to analyze evidence.", "EVIDENCE_ANALYSIS_FAILED");
  }
}
