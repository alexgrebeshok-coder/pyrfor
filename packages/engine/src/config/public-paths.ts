import { DEMO_WORKSPACE_BASE_PATH, isDemoWorkspacePath } from '../demo/workspace-paths';

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
] as const;

export const PUBLIC_AUTH_PATHS = [...PUBLIC_APP_PATHS, DEMO_WORKSPACE_BASE_PATH] as const;

export function isPublicAppPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  return PUBLIC_APP_PATHS.some(
    (publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}

export function isPublicAuthPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  return PUBLIC_AUTH_PATHS.some(
    (publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}

export function isNonPrivatePath(pathname: string | null | undefined): boolean {
  return isPublicAppPath(pathname) || isDemoWorkspacePath(pathname);
}
