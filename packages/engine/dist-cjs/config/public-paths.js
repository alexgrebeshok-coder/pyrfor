"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_AUTH_PATHS = exports.PUBLIC_APP_PATHS = void 0;
exports.isPublicAppPath = isPublicAppPath;
exports.isPublicAuthPath = isPublicAuthPath;
exports.isNonPrivatePath = isNonPrivatePath;
const workspace_paths_1 = require("../demo/workspace-paths");
exports.PUBLIC_APP_PATHS = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/onboarding",
    "/release",
    "/landing",
    "/launch",
    "/demo",
    "/demo/stage1",
];
exports.PUBLIC_AUTH_PATHS = [...exports.PUBLIC_APP_PATHS, workspace_paths_1.DEMO_WORKSPACE_BASE_PATH];
function isPublicAppPath(pathname) {
    if (!pathname)
        return false;
    return exports.PUBLIC_APP_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));
}
function isPublicAuthPath(pathname) {
    if (!pathname)
        return false;
    return exports.PUBLIC_AUTH_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));
}
function isNonPrivatePath(pathname) {
    return isPublicAppPath(pathname) || (0, workspace_paths_1.isDemoWorkspacePath)(pathname);
}
