import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { provisionAuthUser } from "@/lib/auth/provision-user";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { badRequest, notFound, serverError, validationError } from "@/lib/server/api-utils";

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON.");
    }

    const parsed = provisionSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const user = await provisionAuthUser(prisma, parsed.data);
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
