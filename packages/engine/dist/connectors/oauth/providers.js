/**
 * OAuth provider configurations for connector platform v2
 */
export const OAUTH_PROVIDERS = {
    google: {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientIdEnv: "GOOGLE_CLIENT_ID",
        clientSecretEnv: "GOOGLE_CLIENT_SECRET",
        defaultScopes: [
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/userinfo.email",
        ],
        authParams: { access_type: "offline", prompt: "consent" },
    },
    microsoft: {
        authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        clientIdEnv: "MS_CLIENT_ID",
        clientSecretEnv: "MS_CLIENT_SECRET",
        defaultScopes: [
            "Calendars.Read",
            "User.Read",
            "offline_access",
        ],
        authParams: {},
    },
    yandex: {
        authUrl: "https://oauth.yandex.ru/authorize",
        tokenUrl: "https://oauth.yandex.ru/token",
        clientIdEnv: "YANDEX_CLIENT_ID",
        clientSecretEnv: "YANDEX_CLIENT_SECRET",
        defaultScopes: [
            "calendar:read",
            "login:info",
            "login:email",
        ],
        authParams: {},
    },
    intuit: {
        authUrl: "https://appcenter.intuit.com/connect/oauth2",
        tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        clientIdEnv: "QUICKBOOKS_CLIENT_ID",
        clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
        defaultScopes: ["com.intuit.quickbooks.accounting"],
        authParams: {},
    },
    xero: {
        authUrl: "https://login.xero.com/identity/connect/authorize",
        tokenUrl: "https://identity.xero.com/connect/token",
        clientIdEnv: "XERO_CLIENT_ID",
        clientSecretEnv: "XERO_CLIENT_SECRET",
        defaultScopes: [
            "openid",
            "profile",
            "email",
            "accounting.transactions.read",
            "accounting.contacts.read",
            "offline_access",
        ],
        authParams: {},
    },
};
