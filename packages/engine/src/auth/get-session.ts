import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { redirect } from "next/navigation";

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

let getSessionOverride: (() => Promise<SessionResult>) | null = null;

/**
 * Get the current session from server-side
 */
export function setGetSessionForTests(
  resolver: (() => Promise<SessionResult>) | null
) {
  getSessionOverride = resolver;
}

export async function getSession(): Promise<SessionResult> {
  if (getSessionOverride) {
    return getSessionOverride();
  }

  return (await getServerSession(authOptions)) as SessionResult;
}

/**
 * Get the current authenticated user
 * Returns null if not authenticated
 */
export async function getCurrentUser() {
  const session = (await getSession()) as SessionResult;
  
  if (!session?.user) {
    return null;
  }
  
  return session.user;
}

/**
 * Require authentication - throws redirect if not authenticated
 * Use in server components and server actions
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect("/login");
  }
  
  return user;
}

/**
 * Check if user is authenticated
 * Returns boolean without redirecting
 */
export async function isAuthenticated() {
  const user = await getCurrentUser();
  return !!user;
}

/**
 * Get user ID or throw error
 * Useful when you need just the ID
 */
export async function requireUserId() {
  const user = await requireAuth();
  if (!user.id) {
    throw new Error("Authenticated user is missing an id.");
  }
  return user.id;
}
