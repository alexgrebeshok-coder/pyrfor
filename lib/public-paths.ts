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
] as const;

export function isPublicAppPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  return PUBLIC_APP_PATHS.some(
    (publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}
