import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { provisionAuthUser } from "@/lib/auth/provision-user";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import { notFound, serverError } from "@/lib/server/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const provisionSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100).optional(),
  role: z.string().min(2).max(32).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const repairToken = process.env.AUTH_USER_REPAIR_TOKEN?.trim();
    if (!repairToken) {
      return notFound("Auth repair route is not enabled.", "AUTH_REPAIR_DISABLED");
    }

    const authResult = await authorizeRequest(request, {
      apiKey: repairToken,
      requireApiKey: true,
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const parsed = await validateBody(request, provisionSchema, {
      invalidJsonCode: "BAD_REQUEST",
      invalidJsonMessage: "Request body must be valid JSON.",
    });
    if (isValidationError(parsed)) {
      return parsed;
    }

    const user = await provisionAuthUser(prisma, parsed);
    logger.info("Provisioned auth user via ops route", {
      email: user.email,
      role: user.role,
    });

    return NextResponse.json({
      ok: true,
      user,
    });
  } catch (error) {
    return serverError(error, "Failed to provision auth user.");
  }
}
