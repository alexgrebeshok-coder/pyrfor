import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import type { Adapter } from "next-auth/adapters";
import bcrypt from "bcryptjs";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";

const ALLOW_INSECURE_EMAIL_VERIFICATION_BYPASS =
  process.env.SKIP_EMAIL_VERIFICATION === "true" && process.env.NODE_ENV !== "production";

async function findUserMembership(userId: string) {
  return prisma.membership.findFirst({
    where: { userId },
    select: {
      role: true,
      organization: {
        select: {
          slug: true,
        },
      },
      workspaceMemberships: {
        select: { workspaceId: true },
      },
    },
  });
}

// Extend NextAuth types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role?: string;
      organizationSlug?: string;
      workspaceId?: string;
    };
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        // Rate limiting: 5 attempts per 15 minutes per email/IP
        const clientIp = req.headers?.["x-forwarded-for"] || "unknown";
        const rateLimitKey = `auth:${credentials.email}:${clientIp}`;
        const { allowed, remaining, resetAt } = checkAuthRateLimit(rateLimitKey);
        
        if (!allowed) {
          const resetTime = resetAt ? Math.ceil((resetAt - Date.now()) / 60000) : 15;
          throw new Error(`Too many login attempts. Please try again in ${resetTime} minutes.`);
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email,
          },
        });

        if (!user || !user.password) {
          // Don't reveal whether user exists
          throw new Error("Invalid email or password");
        }

        // Check email verification (skip if SKIP_EMAIL_VERIFICATION is set)
        if (!user.emailVerified && !ALLOW_INSECURE_EMAIL_VERIFICATION_BYPASS) {
          throw new Error("Please verify your email address before logging in");
        }

        // NOTE: Password hashing best practices:
        // - bcryptjs is used for secure password hashing
        // - Salt rounds: 10 (good balance of security and performance)
        // - Never store plain text passwords in production
        const passwordMatch = await bcrypt.compare(credentials.password, user.password);

        if (!passwordMatch) {
          throw new Error("Invalid email or password");
        }

        const membership = await findUserMembership(user.id);

        if (!membership) {
          logger.warn("Credentials sign-in rejected - user has no membership", {
            email: user.email,
            userId: user.id,
          });
          throw new Error("Your account is not provisioned for CEOClaw yet");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: membership.role,
          organizationSlug: membership.organization.slug,
          workspaceId: membership.workspaceMemberships[0]?.workspaceId,
        };
      },
    }),
    // Google OAuth Provider (optional - configured if env vars exist)
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    // GitHub OAuth Provider (optional - configured if env vars exist)
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name;
        session.user.image = token.picture;
        session.user.role = token.role as string | undefined;
        session.user.organizationSlug = token.organizationSlug as string | undefined;
        session.user.workspaceId = token.workspaceId as string | undefined;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;

        // Fetch user role and workspace from Membership
        const membership = await findUserMembership(user.id);

        if (membership) {
          token.role = membership.role;
          token.organizationSlug = membership.organization.slug;
          token.workspaceId = membership.workspaceMemberships[0]?.workspaceId;
        }
      }
      return token;
    },
    async signIn({ user, account, profile }) {
      // Allow credentials provider (already validated in authorize)
      if (account?.provider === "credentials") {
        return true;
      }

      // For OAuth providers, check if user exists in database
      // This prevents unauthorized users from accessing the system
      if (account?.provider === "google" || account?.provider === "github") {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email || "" }
        });

        if (!existingUser) {
          // Reject unknown users
          // NOTE: For public apps, you might want to auto-create users instead
          logger.warn("OAuth sign-in rejected - unknown user", { email: user.email });
          return false;
        }

        // Check if email is verified (skip if SKIP_EMAIL_VERIFICATION is set)
        if (!existingUser.emailVerified && !ALLOW_INSECURE_EMAIL_VERIFICATION_BYPASS) {
          logger.warn("OAuth sign-in rejected - email not verified", { email: user.email });
          return false;
        }

        const membership = await findUserMembership(existingUser.id);

        if (!membership) {
          logger.warn("OAuth sign-in rejected - user has no membership", {
            email: user.email,
            userId: existingUser.id,
          });
          return false;
        }

        return true;
      }

      // Unknown provider
      return false;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      logger.info("User signed in", { email: user.email, provider: account?.provider });
    },
    async signOut({ token }) {
      logger.info("User signed out", { email: token?.email });
    },
  },
  debug: process.env.NODE_ENV === "development",
};
