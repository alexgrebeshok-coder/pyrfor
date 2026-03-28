"use client";

import { usePathname } from "next/navigation";

import { isDemoWorkspacePath } from "@/lib/demo/workspace-paths";

export function useDemoWorkspaceMode() {
  const pathname = usePathname();
  return isDemoWorkspacePath(pathname);
}
