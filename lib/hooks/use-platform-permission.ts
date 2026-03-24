"use client";

import { useMemo } from "react";

import { usePreferences } from "@/contexts/preferences-context";
import {
  canAccessWorkspace,
  hasPermission,
  type PlatformPermission,
  type PlatformWorkspaceId,
} from "@/lib/policy/access";

export function usePlatformPermission(
  permission: PlatformPermission,
  workspaceId?: PlatformWorkspaceId
) {
  const { accessProfile, activeWorkspace } = usePreferences();
  const targetWorkspaceId = workspaceId ?? activeWorkspace.id;

  return useMemo(
    () => ({
      accessProfile,
      allowed:
        canAccessWorkspace(accessProfile.role, targetWorkspaceId) &&
        hasPermission(accessProfile.role, permission),
      workspaceId: targetWorkspaceId,
    }),
    [accessProfile, permission, targetWorkspaceId]
  );
}
