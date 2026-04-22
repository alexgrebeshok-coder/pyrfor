import type { NextRequest } from "next/server";

import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";

export function readServerAccessProfile(request: NextRequest): AccessProfile {
  return buildAccessProfile({
    organizationSlug: request.headers.get("x-ceoclaw-organization"),
    userId: request.headers.get("x-ceoclaw-user-id"),
    name: request.headers.get("x-ceoclaw-user-name"),
    role: request.headers.get("x-ceoclaw-role"),
    workspaceId:
      request.headers.get("x-ceoclaw-workspace") ??
      new URL(request.url).searchParams.get("workspaceId"),
  });
}
