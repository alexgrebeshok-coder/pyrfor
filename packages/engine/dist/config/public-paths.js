import { DEMO_WORKSPACE_BASE_PATH, isDemoWorkspacePath } from '../demo/workspace-paths.js';
export const PUBLIC_APP_PATHS = [
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
export const PUBLIC_AUTH_PATHS = [...PUBLIC_APP_PATHS, DEMO_WORKSPACE_BASE_PATH];
export function isPublicAppPath(pathname) {
    if (!pathname)
        return false;
    return PUBLIC_APP_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));
}
export function isPublicAuthPath(pathname) {
    if (!pathname)
        return false;
    return PUBLIC_AUTH_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));
}
export function isNonPrivatePath(pathname) {
    return isPublicAppPath(pathname) || isDemoWorkspacePath(pathname);
}
