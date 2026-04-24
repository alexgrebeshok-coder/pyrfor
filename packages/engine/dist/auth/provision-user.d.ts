import type { PrismaClient } from "@prisma/client";
export interface ProvisionAuthUserInput {
    email: string;
    password: string;
    name?: string;
    role?: string;
    organizationName?: string;
    workspaceName?: string;
    workspaceKey?: string;
}
export interface ProvisionedAuthUser {
    id: string;
    email: string | null;
    name: string | null;
    emailVerified: Date | null;
    role: string;
}
export declare function hashPassword(password: string, saltRounds?: number): Promise<string>;
export declare function provisionAuthUser(prisma: PrismaClient, input: ProvisionAuthUserInput): Promise<ProvisionedAuthUser>;
//# sourceMappingURL=provision-user.d.ts.map