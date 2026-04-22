import {
  normalizePlatformRole,
  resolveAccessibleWorkspace,
  type PlatformRole,
  type PlatformWorkspaceId,
} from "@/lib/policy/access";

export const ACCESS_PROFILE_STORAGE_KEY = "ceoclaw-access-profile";

export interface AccessProfile {
  organizationSlug: string;
  userId: string;
  name: string;
  role: PlatformRole;
  workspaceId: PlatformWorkspaceId;
}

interface AccessProfileInput {
  organizationSlug?: unknown;
  userId?: unknown;
  name?: unknown;
  role?: unknown;
  workspaceId?: unknown;
}

function getDefaultRole(): PlatformRole {
  return normalizePlatformRole(
    process.env.NEXT_PUBLIC_CEOCLAW_FAKE_ROLE ?? process.env.CEOCLAW_FAKE_ROLE ?? "PM"
  );
}

function getDefaultWorkspaceId(role: PlatformRole): PlatformWorkspaceId {
  return resolveAccessibleWorkspace(
    role,
    process.env.NEXT_PUBLIC_CEOCLAW_FAKE_WORKSPACE ??
      process.env.CEOCLAW_FAKE_WORKSPACE ??
      null
  ).id;
}

export function buildAccessProfile(input: AccessProfileInput = {}): AccessProfile {
  const role = normalizePlatformRole(input.role, getDefaultRole());
  const workspaceId = resolveAccessibleWorkspace(
    role,
    typeof input.workspaceId === "string" ? input.workspaceId : getDefaultWorkspaceId(role)
  ).id;

  return {
    organizationSlug:
      typeof input.organizationSlug === "string" && input.organizationSlug.trim()
        ? input.organizationSlug.trim()
        : "ceoclaw-demo",
    userId:
      typeof input.userId === "string" && input.userId.trim()
        ? input.userId.trim()
        : "demo-user",
    name:
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : "Demo Operator",
    role,
    workspaceId,
  };
}

export function readClientAccessProfile(): AccessProfile {
  if (typeof window === "undefined") {
    return buildAccessProfile();
  }

  try {
    const raw = window.localStorage.getItem(ACCESS_PROFILE_STORAGE_KEY);
    if (!raw) {
      return buildAccessProfile();
    }

    const parsed = JSON.parse(raw) as AccessProfileInput;
    return buildAccessProfile(parsed);
  } catch {
    return buildAccessProfile();
  }
}
