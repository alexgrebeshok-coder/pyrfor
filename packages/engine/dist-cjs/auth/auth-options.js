"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authOptions = void 0;
const credentials_1 = __importDefault(require("next-auth/providers/credentials"));
const google_1 = __importDefault(require("next-auth/providers/google"));
const github_1 = __importDefault(require("next-auth/providers/github"));
const prisma_adapter_1 = require("@auth/prisma-adapter");
const prisma_1 = require("../prisma");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const rate_limit_1 = require("./rate-limit");
const logger_1 = require("../observability/logger");
const ALLOW_INSECURE_EMAIL_VERIFICATION_BYPASS = process.env.SKIP_EMAIL_VERIFICATION === "true" && process.env.NODE_ENV !== "production";
async function findUserMembership(userId) {
    return prisma_1.prisma.membership.findFirst({
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
exports.authOptions = {
    adapter: (0, prisma_adapter_1.PrismaAdapter)(prisma_1.prisma),
    session: {
        strategy: "jwt",
    },
    pages: {
        signIn: "/login",
        error: "/login",
    },
    providers: [
        (0, credentials_1.default)({
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
                const { allowed, resetAt } = (0, rate_limit_1.checkAuthRateLimit)(rateLimitKey);
                if (!allowed) {
                    const resetTime = resetAt ? Math.ceil((resetAt - Date.now()) / 60000) : 15;
                    throw new Error(`Too many login attempts. Please try again in ${resetTime} minutes.`);
                }
                const user = await prisma_1.prisma.user.findUnique({
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
                const passwordMatch = await bcryptjs_1.default.compare(credentials.password, user.password);
                if (!passwordMatch) {
                    throw new Error("Invalid email or password");
                }
                const membership = await findUserMembership(user.id);
                if (!membership) {
                    logger_1.logger.warn("Credentials sign-in rejected - user has no membership", {
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
                (0, google_1.default)({
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                }),
            ]
            : []),
        // GitHub OAuth Provider (optional - configured if env vars exist)
        ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
            ? [
                (0, github_1.default)({
                    clientId: process.env.GITHUB_CLIENT_ID,
                    clientSecret: process.env.GITHUB_CLIENT_SECRET,
                }),
            ]
            : []),
    ],
    callbacks: {
        async session({ session, token }) {
            if (token) {
                session.user.id = token.id;
                session.user.email = token.email;
                session.user.name = token.name;
                session.user.image = token.picture;
                session.user.role = token.role;
                session.user.organizationSlug = token.organizationSlug;
                session.user.workspaceId = token.workspaceId;
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
        async signIn({ user, account, profile: _profile }) {
            // Allow credentials provider (already validated in authorize)
            if (account?.provider === "credentials") {
                return true;
            }
            // For OAuth providers, check if user exists in database
            // This prevents unauthorized users from accessing the system
            if (account?.provider === "google" || account?.provider === "github") {
                const existingUser = await prisma_1.prisma.user.findUnique({
                    where: { email: user.email || "" }
                });
                if (!existingUser) {
                    // Reject unknown users
                    // NOTE: For public apps, you might want to auto-create users instead
                    logger_1.logger.warn("OAuth sign-in rejected - unknown user", { email: user.email });
                    return false;
                }
                // Check if email is verified (skip if SKIP_EMAIL_VERIFICATION is set)
                if (!existingUser.emailVerified && !ALLOW_INSECURE_EMAIL_VERIFICATION_BYPASS) {
                    logger_1.logger.warn("OAuth sign-in rejected - email not verified", { email: user.email });
                    return false;
                }
                const membership = await findUserMembership(existingUser.id);
                if (!membership) {
                    logger_1.logger.warn("OAuth sign-in rejected - user has no membership", {
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
        async signIn({ user, account, profile: _profile }) {
            logger_1.logger.info("User signed in", { email: user.email, provider: account?.provider });
        },
        async signOut({ token }) {
            logger_1.logger.info("User signed out", { email: token?.email });
        },
    },
    debug: process.env.NODE_ENV === "development",
};
