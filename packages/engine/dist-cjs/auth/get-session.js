"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setGetSessionForTests = setGetSessionForTests;
exports.getSession = getSession;
exports.getCurrentUser = getCurrentUser;
exports.requireAuth = requireAuth;
exports.isAuthenticated = isAuthenticated;
exports.requireUserId = requireUserId;
const next_auth_1 = require("next-auth");
const auth_options_1 = require("./auth-options");
const navigation_1 = require("next/navigation");
let getSessionOverride = null;
/**
 * Get the current session from server-side
 */
function setGetSessionForTests(resolver) {
    getSessionOverride = resolver;
}
async function getSession() {
    if (getSessionOverride) {
        return getSessionOverride();
    }
    return (await (0, next_auth_1.getServerSession)(auth_options_1.authOptions));
}
/**
 * Get the current authenticated user
 * Returns null if not authenticated
 */
async function getCurrentUser() {
    const session = (await getSession());
    if (!session?.user) {
        return null;
    }
    return session.user;
}
/**
 * Require authentication - throws redirect if not authenticated
 * Use in server components and server actions
 */
async function requireAuth() {
    const user = await getCurrentUser();
    if (!user) {
        (0, navigation_1.redirect)("/login");
    }
    return user;
}
/**
 * Check if user is authenticated
 * Returns boolean without redirecting
 */
async function isAuthenticated() {
    const user = await getCurrentUser();
    return !!user;
}
/**
 * Get user ID or throw error
 * Useful when you need just the ID
 */
async function requireUserId() {
    const user = await requireAuth();
    if (!user.id) {
        throw new Error("Authenticated user is missing an id.");
    }
    return user.id;
}
