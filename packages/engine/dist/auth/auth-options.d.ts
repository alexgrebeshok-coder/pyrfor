import type { NextAuthOptions } from "next-auth";
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
export declare const authOptions: NextAuthOptions;
//# sourceMappingURL=auth-options.d.ts.map