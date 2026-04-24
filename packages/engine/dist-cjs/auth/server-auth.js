"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readServerAccessProfile = readServerAccessProfile;
const access_profile_1 = require("./access-profile");
function readServerAccessProfile(request) {
    return (0, access_profile_1.buildAccessProfile)({
        organizationSlug: request.headers.get("x-ceoclaw-organization"),
        userId: request.headers.get("x-ceoclaw-user-id"),
        name: request.headers.get("x-ceoclaw-user-name"),
        role: request.headers.get("x-ceoclaw-role"),
        workspaceId: request.headers.get("x-ceoclaw-workspace") ??
            new URL(request.url).searchParams.get("workspaceId"),
    });
}
