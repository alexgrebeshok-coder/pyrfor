"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMO_WORKSPACE_BASE_PATH = void 0;
exports.isDemoWorkspacePath = isDemoWorkspacePath;
exports.stripDemoWorkspacePrefix = stripDemoWorkspacePrefix;
exports.toDemoWorkspaceHref = toDemoWorkspaceHref;
exports.DEMO_WORKSPACE_BASE_PATH = "/demo/workspace";
function isDemoWorkspacePath(pathname) {
    if (!pathname) {
        return false;
    }
    return (pathname === exports.DEMO_WORKSPACE_BASE_PATH ||
        pathname.startsWith(`${exports.DEMO_WORKSPACE_BASE_PATH}/`));
}
function stripDemoWorkspacePrefix(pathname) {
    if (!pathname) {
        return "/";
    }
    if (!isDemoWorkspacePath(pathname)) {
        return pathname;
    }
    const stripped = pathname.slice(exports.DEMO_WORKSPACE_BASE_PATH.length);
    return stripped.length > 0 ? stripped : "/";
}
function toDemoWorkspaceHref(href, currentPathname) {
    if (!href.startsWith("/")) {
        return href;
    }
    if (!isDemoWorkspacePath(currentPathname)) {
        return href;
    }
    if (isDemoWorkspacePath(href)) {
        return href;
    }
    return href === "/"
        ? exports.DEMO_WORKSPACE_BASE_PATH
        : `${exports.DEMO_WORKSPACE_BASE_PATH}${href}`;
}
