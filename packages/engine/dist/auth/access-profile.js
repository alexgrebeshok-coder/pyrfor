import { normalizePlatformRole, resolveAccessibleWorkspace, } from '../policy/access.js';
export const ACCESS_PROFILE_STORAGE_KEY = "ceoclaw-access-profile";
function getDefaultRole() {
    var _a, _b;
    return normalizePlatformRole((_b = (_a = process.env.NEXT_PUBLIC_CEOCLAW_FAKE_ROLE) !== null && _a !== void 0 ? _a : process.env.CEOCLAW_FAKE_ROLE) !== null && _b !== void 0 ? _b : "PM");
}
function getDefaultWorkspaceId(role) {
    var _a, _b;
    return resolveAccessibleWorkspace(role, (_b = (_a = process.env.NEXT_PUBLIC_CEOCLAW_FAKE_WORKSPACE) !== null && _a !== void 0 ? _a : process.env.CEOCLAW_FAKE_WORKSPACE) !== null && _b !== void 0 ? _b : null).id;
}
export function buildAccessProfile(input = {}) {
    const role = normalizePlatformRole(input.role, getDefaultRole());
    const workspaceId = resolveAccessibleWorkspace(role, typeof input.workspaceId === "string" ? input.workspaceId : getDefaultWorkspaceId(role)).id;
    return {
        organizationSlug: typeof input.organizationSlug === "string" && input.organizationSlug.trim()
            ? input.organizationSlug.trim()
            : "ceoclaw-demo",
        userId: typeof input.userId === "string" && input.userId.trim()
            ? input.userId.trim()
            : "demo-user",
        name: typeof input.name === "string" && input.name.trim()
            ? input.name.trim()
            : "Demo Operator",
        role,
        workspaceId,
    };
}
export function readClientAccessProfile() {
    if (typeof window === "undefined") {
        return buildAccessProfile();
    }
    try {
        const raw = window.localStorage.getItem(ACCESS_PROFILE_STORAGE_KEY);
        if (!raw) {
            return buildAccessProfile();
        }
        const parsed = JSON.parse(raw);
        return buildAccessProfile(parsed);
    }
    catch (_a) {
        return buildAccessProfile();
    }
}
