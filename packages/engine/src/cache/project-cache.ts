import { LRUCache } from "lru-cache";
import type { Project } from "../types";

/**
 * Project name cache
 * 
 * Caches project name → project lookups to reduce API calls
 * TTL: 5 minutes
 */
const projectCache = new LRUCache<string, Project>({
  max: 50, // Cache up to 50 projects
  ttl: 300000, // 5 minutes
});

export function getCachedProject(name: string): Project | undefined {
  return projectCache.get(name.toLowerCase());
}

export function setCachedProject(name: string, project: Project): void {
  projectCache.set(name.toLowerCase(), project);
}

export function clearProjectCache(): void {
  projectCache.clear();
}
