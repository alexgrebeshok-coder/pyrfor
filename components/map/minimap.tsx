"use client";

import type { Project } from "@/types/map";

interface MinimapProps {
  projects: Project[];
  size?: { width: number; height: number };
}

export function Minimap({ projects, size = { width: 200, height: 150 } }: MinimapProps) {
  const gridSize = { cols: 4, rows: 3 };
  void projects;
  void size;
  void gridSize;

  return null;
}
