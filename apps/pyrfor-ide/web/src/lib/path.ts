/**
 * Path utilities for workspace-relative paths
 */

/** Normalize workspace path (remove trailing slash, resolve ..) */
export function normalizeWorkspacePath(path: string, _homeHint?: string): string {
  return path
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    || '/';
}

/** Convert absolute path to workspace-relative */
export function toWorkspaceRelativePath(absPath: string, workspaceRoot: string): string {
  const normalized = normalizeWorkspacePath(absPath);
  const root = normalizeWorkspacePath(workspaceRoot);
  if (normalized.startsWith(root)) {
    return normalized.slice(root.length) || '/';
  }
  return absPath;
}
