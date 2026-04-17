import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { createMeetingToActionPacket } from "@/lib/meetings/meeting-to-action";
import { isAIUnavailableError } from "@/lib/ai/server-runs";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import { serverError, serviceUnavailable } from "@/lib/server/api-utils";
import { meetingToActionSchema } from "@/lib/validators/meeting-to-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "RUN_MEETING_TO_ACTION",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const parsed = await validateBody(request, meetingToActionSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const packet = await createMeetingToActionPacket(parsed);
    return NextResponse.json(packet, { status: 201 });
  } catch (error) {
    if (isAIUnavailableError(error)) {
      return serviceUnavailable(error.message, "AI_UNAVAILABLE");
    }

    return serverError(
      error,
      "Failed to create meeting-to-action packet.",
      "MEETING_TO_ACTION_FAILED"
    );
  }
}
