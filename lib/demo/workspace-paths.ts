export const DEMO_WORKSPACE_BASE_PATH = "/demo/workspace";

export function isDemoWorkspacePath(pathname: string | null | undefined) {
  if (!pathname) {
    return false;
  }

  return (
    pathname === DEMO_WORKSPACE_BASE_PATH ||
    pathname.startsWith(`${DEMO_WORKSPACE_BASE_PATH}/`)
  );
}

export function stripDemoWorkspacePrefix(pathname: string | null | undefined) {
  if (!pathname) {
    return "/";
  }

  if (!isDemoWorkspacePath(pathname)) {
    return pathname;
  }

  const stripped = pathname.slice(DEMO_WORKSPACE_BASE_PATH.length);
  return stripped.length > 0 ? stripped : "/";
}

export function toDemoWorkspaceHref(
  href: string,
  currentPathname?: string | null | undefined
) {
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
    ? DEMO_WORKSPACE_BASE_PATH
    : `${DEMO_WORKSPACE_BASE_PATH}${href}`;
}
