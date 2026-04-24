"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedProject = getCachedProject;
exports.setCachedProject = setCachedProject;
exports.clearProjectCache = clearProjectCache;
const lru_cache_1 = require("lru-cache");
/**
 * Project name cache
 *
 * Caches project name → project lookups to reduce API calls
 * TTL: 5 minutes
 */
const projectCache = new lru_cache_1.LRUCache({
    max: 50, // Cache up to 50 projects
    ttl: 300000, // 5 minutes
});
function getCachedProject(name) {
    return projectCache.get(name.toLowerCase());
}
function setCachedProject(name, project) {
    projectCache.set(name.toLowerCase(), project);
}
function clearProjectCache() {
    projectCache.clear();
}
