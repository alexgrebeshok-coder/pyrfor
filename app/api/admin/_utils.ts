import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { forbidden, notFound } from "@/lib/server/api-utils";

export async function authorizeAdminRoute(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return notFound("Legacy admin maintenance routes are disabled in production.");
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorizeRequest(request, { requireApiKey: true });
  }

  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  if (authResult.accessProfile.role !== "EXEC" && authResult.accessProfile.role !== "PM") {
    return forbidden("Administrator privileges are required.", "ADMIN_FORBIDDEN");
  }

  return authResult;
}
