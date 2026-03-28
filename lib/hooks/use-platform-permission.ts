"use client";

import { useMemo } from "react";

import { useDemoWorkspaceMode } from "@/lib/demo/use-demo-workspace";
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
  const isDemoWorkspace = useDemoWorkspaceMode();
  const targetWorkspaceId = workspaceId ?? activeWorkspace.id;

  return useMemo(
    () => ({
      accessProfile,
      allowed:
        !isDemoWorkspace &&
        canAccessWorkspace(accessProfile.role, targetWorkspaceId) &&
        hasPermission(accessProfile.role, permission),
      workspaceId: targetWorkspaceId,
    }),
    [accessProfile, isDemoWorkspace, permission, targetWorkspaceId]
  );
}
