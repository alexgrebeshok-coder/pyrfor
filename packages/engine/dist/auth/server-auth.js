import { buildAccessProfile } from './access-profile';
export function readServerAccessProfile(request) {
    var _a;
    return buildAccessProfile({
        organizationSlug: request.headers.get("x-ceoclaw-organization"),
        userId: request.headers.get("x-ceoclaw-user-id"),
        name: request.headers.get("x-ceoclaw-user-name"),
        role: request.headers.get("x-ceoclaw-role"),
        workspaceId: (_a = request.headers.get("x-ceoclaw-workspace")) !== null && _a !== void 0 ? _a : new URL(request.url).searchParams.get("workspaceId"),
    });
}
