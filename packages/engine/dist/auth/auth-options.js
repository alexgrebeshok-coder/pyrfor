var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from '../prisma.js';
import bcrypt from "bcryptjs";
import { checkAuthRateLimit } from './rate-limit.js';
import { logger } from '../observability/logger.js';
const ALLOW_INSECURE_EMAIL_VERIFICATION_BYPASS = process.env.SKIP_EMAIL_VERIFICATION === "true" && process.env.NODE_ENV !== "production";
function findUserMembership(userId) {
    return __awaiter(this, void 0, void 0, function* () {
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
    });
}
export const authOptions = {
    adapter: PrismaAdapter(prisma),
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
            authorize(credentials, req) {
                return __awaiter(this, void 0, void 0, function* () {
                    var _a, _b;
                    if (!(credentials === null || credentials === void 0 ? void 0 : credentials.email) || !(credentials === null || credentials === void 0 ? void 0 : credentials.password)) {
                        throw new Error("Email and password are required");
                    }
                    // Rate limiting: 5 attempts per 15 minutes per email/IP
                    const clientIp = ((_a = req.headers) === null || _a === void 0 ? void 0 : _a["x-forwarded-for"]) || "unknown";
                    const rateLimitKey = `auth:${credentials.email}:${clientIp}`;
                    const { allowed, resetAt } = checkAuthRateLimit(rateLimitKey);
                    if (!allowed) {
                        const resetTime = resetAt ? Math.ceil((resetAt - Date.now()) / 60000) : 15;
                        throw new Error(`Too many login attempts. Please try again in ${resetTime} minutes.`);
                    }
                    const user = yield prisma.user.findUnique({
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
                    const passwordMatch = yield bcrypt.compare(credentials.password, user.password);
                    if (!passwordMatch) {
                        throw new Error("Invalid email or password");
                    }
                    const membership = yield findUserMembership(user.id);
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
                        workspaceId: (_b = membership.workspaceMemberships[0]) === null || _b === void 0 ? void 0 : _b.workspaceId,
                    };
                });
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
        session(_a) {
            return __awaiter(this, arguments, void 0, function* ({ session, token }) {
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
            });
        },
        jwt(_a) {
            return __awaiter(this, arguments, void 0, function* ({ token, user }) {
                var _b;
                if (user) {
                    token.id = user.id;
                    token.email = user.email;
                    // Fetch user role and workspace from Membership
                    const membership = yield findUserMembership(user.id);
                    if (membership) {
                        token.role = membership.role;
                        token.organizationSlug = membership.organization.slug;
                        token.workspaceId = (_b = membership.workspaceMemberships[0]) === null || _b === void 0 ? void 0 : _b.workspaceId;
                    }
                }
                return token;
            });
        },
        signIn(_a) {
            return __awaiter(this, arguments, void 0, function* ({ user, account, profile: _profile }) {
                // Allow credentials provider (already validated in authorize)
                if ((account === null || account === void 0 ? void 0 : account.provider) === "credentials") {
                    return true;
                }
                // For OAuth providers, check if user exists in database
                // This prevents unauthorized users from accessing the system
                if ((account === null || account === void 0 ? void 0 : account.provider) === "google" || (account === null || account === void 0 ? void 0 : account.provider) === "github") {
                    const existingUser = yield prisma.user.findUnique({
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
                    const membership = yield findUserMembership(existingUser.id);
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
            });
        },
    },
    events: {
        signIn(_a) {
            return __awaiter(this, arguments, void 0, function* ({ user, account, profile: _profile }) {
                logger.info("User signed in", { email: user.email, provider: account === null || account === void 0 ? void 0 : account.provider });
            });
        },
        signOut(_a) {
            return __awaiter(this, arguments, void 0, function* ({ token }) {
                logger.info("User signed out", { email: token === null || token === void 0 ? void 0 : token.email });
            });
        },
    },
    debug: process.env.NODE_ENV === "development",
};
