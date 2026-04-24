import { LRUCache } from "lru-cache";
/**
 * Project name cache
 *
 * Caches project name → project lookups to reduce API calls
 * TTL: 5 minutes
 */
const projectCache = new LRUCache({
    max: 50, // Cache up to 50 projects
    ttl: 300000, // 5 minutes
});
export function getCachedProject(name) {
    return projectCache.get(name.toLowerCase());
}
export function setCachedProject(name, project) {
    projectCache.set(name.toLowerCase(), project);
}
export function clearProjectCache() {
    projectCache.clear();
}
