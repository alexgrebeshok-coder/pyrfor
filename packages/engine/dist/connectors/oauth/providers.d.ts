/**
 * OAuth provider configurations for connector platform v2
 */
export interface OAuthProviderConfig {
    authUrl: string;
    tokenUrl: string;
    clientIdEnv: string;
    clientSecretEnv: string;
    /** Default scopes requested during authorization */
    defaultScopes: string[];
    /** Extra params to add to auth URL (e.g., access_type=offline) */
    authParams?: Record<string, string>;
}
export declare const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig>;
export type OAuthProviderName = keyof typeof OAUTH_PROVIDERS;
//# sourceMappingURL=providers.d.ts.map