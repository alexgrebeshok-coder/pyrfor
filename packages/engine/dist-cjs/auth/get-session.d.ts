type SessionUser = {
    id?: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    role?: string;
    organizationSlug?: string;
    workspaceId?: string;
};
type SessionResult = {
    user?: SessionUser;
} | null;
/**
 * Get the current session from server-side
 */
export declare function setGetSessionForTests(resolver: (() => Promise<SessionResult>) | null): void;
export declare function getSession(): Promise<SessionResult>;
/**
 * Get the current authenticated user
 * Returns null if not authenticated
 */
export declare function getCurrentUser(): Promise<SessionUser | null>;
/**
 * Require authentication - throws redirect if not authenticated
 * Use in server components and server actions
 */
export declare function requireAuth(): Promise<SessionUser>;
/**
 * Check if user is authenticated
 * Returns boolean without redirecting
 */
export declare function isAuthenticated(): Promise<boolean>;
/**
 * Get user ID or throw error
 * Useful when you need just the ID
 */
export declare function requireUserId(): Promise<string>;
export {};
//# sourceMappingURL=get-session.d.ts.map