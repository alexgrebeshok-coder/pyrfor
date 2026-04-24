"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_PROFILE_STORAGE_KEY = void 0;
exports.buildAccessProfile = buildAccessProfile;
exports.readClientAccessProfile = readClientAccessProfile;
const access_1 = require("../policy/access");
exports.ACCESS_PROFILE_STORAGE_KEY = "ceoclaw-access-profile";
function getDefaultRole() {
    return (0, access_1.normalizePlatformRole)(process.env.NEXT_PUBLIC_CEOCLAW_FAKE_ROLE ?? process.env.CEOCLAW_FAKE_ROLE ?? "PM");
}
function getDefaultWorkspaceId(role) {
    return (0, access_1.resolveAccessibleWorkspace)(role, process.env.NEXT_PUBLIC_CEOCLAW_FAKE_WORKSPACE ??
        process.env.CEOCLAW_FAKE_WORKSPACE ??
        null).id;
}
function buildAccessProfile(input = {}) {
    const role = (0, access_1.normalizePlatformRole)(input.role, getDefaultRole());
    const workspaceId = (0, access_1.resolveAccessibleWorkspace)(role, typeof input.workspaceId === "string" ? input.workspaceId : getDefaultWorkspaceId(role)).id;
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
function readClientAccessProfile() {
    if (typeof window === "undefined") {
        return buildAccessProfile();
    }
    try {
        const raw = window.localStorage.getItem(exports.ACCESS_PROFILE_STORAGE_KEY);
        if (!raw) {
            return buildAccessProfile();
        }
        const parsed = JSON.parse(raw);
        return buildAccessProfile(parsed);
    }
    catch {
        return buildAccessProfile();
    }
}
