import { type PlatformRole, type PlatformWorkspaceId } from '../policy/access';
export declare const ACCESS_PROFILE_STORAGE_KEY = "ceoclaw-access-profile";
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
export declare function buildAccessProfile(input?: AccessProfileInput): AccessProfile;
export declare function readClientAccessProfile(): AccessProfile;
export {};
//# sourceMappingURL=access-profile.d.ts.map