var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { redirect } from "next/navigation";
let getSessionOverride = null;
/**
 * Get the current session from server-side
 */
export function setGetSessionForTests(resolver) {
    getSessionOverride = resolver;
}
export function getSession() {
    return __awaiter(this, void 0, void 0, function* () {
        if (getSessionOverride) {
            return getSessionOverride();
        }
        return (yield getServerSession(authOptions));
    });
}
/**
 * Get the current authenticated user
 * Returns null if not authenticated
 */
export function getCurrentUser() {
    return __awaiter(this, void 0, void 0, function* () {
        const session = (yield getSession());
        if (!(session === null || session === void 0 ? void 0 : session.user)) {
            return null;
        }
        return session.user;
    });
}
/**
 * Require authentication - throws redirect if not authenticated
 * Use in server components and server actions
 */
export function requireAuth() {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getCurrentUser();
        if (!user) {
            redirect("/login");
        }
        return user;
    });
}
/**
 * Check if user is authenticated
 * Returns boolean without redirecting
 */
export function isAuthenticated() {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getCurrentUser();
        return !!user;
    });
}
/**
 * Get user ID or throw error
 * Useful when you need just the ID
 */
export function requireUserId() {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield requireAuth();
        if (!user.id) {
            throw new Error("Authenticated user is missing an id.");
        }
        return user.id;
    });
}
