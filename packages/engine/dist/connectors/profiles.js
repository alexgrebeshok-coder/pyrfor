/**
 * Regional provider profiles — preset connector configurations per region
 */
export const REGION_PROFILES = {
    russia: {
        label: "Россия",
        labelEn: "Russia",
        connectors: ["one-c", "yandex-calendar", "yandex-maps", "telegram"],
        defaultMapProvider: "yandex",
        defaultCalendarProvider: "internal",
        defaultFinanceProvider: "one-c",
        currency: "RUB",
        locale: "ru",
        timezone: "Europe/Moscow",
        description: "1С для финансов, Яндекс Карты, Telegram для уведомлений",
    },
    global_smb: {
        label: "Global (SMB)",
        labelEn: "Global (Small/Medium Business)",
        connectors: [
            "quickbooks",
            "google-calendar",
            "google-maps",
            "email",
        ],
        defaultMapProvider: "google",
        defaultCalendarProvider: "google",
        defaultFinanceProvider: "quickbooks",
        currency: "USD",
        locale: "en",
        timezone: "America/New_York",
        description: "QuickBooks for finance, Google Maps, Google Calendar, Email notifications",
    },
    global_enterprise: {
        label: "Global (Enterprise)",
        labelEn: "Global (Enterprise)",
        connectors: [
            "dynamics365",
            "microsoft-calendar",
            "google-maps",
            "email",
            "telegram",
        ],
        defaultMapProvider: "google",
        defaultCalendarProvider: "microsoft",
        defaultFinanceProvider: "dynamics365",
        currency: "USD",
        locale: "en",
        timezone: "UTC",
        description: "Microsoft Dynamics 365, MS 365 Calendar, Google Maps, Email + Telegram",
    },
    hybrid: {
        label: "Гибрид / Custom",
        labelEn: "Custom / Hybrid",
        connectors: [],
        defaultMapProvider: undefined,
        defaultCalendarProvider: undefined,
        defaultFinanceProvider: undefined,
        currency: undefined,
        locale: undefined,
        timezone: undefined,
        description: "Choose your own connectors and providers",
    },
};
/**
 * Get recommended connectors for a profile
 */
export function getProfileConnectors(profile) {
    var _a, _b;
    return (_b = (_a = REGION_PROFILES[profile]) === null || _a === void 0 ? void 0 : _a.connectors) !== null && _b !== void 0 ? _b : [];
}
/**
 * Get all profile options for onboarding UI
 */
export function getProfileOptions() {
    return Object.entries(REGION_PROFILES).map(([id, cfg]) => ({
        id,
        label: cfg.label,
        labelEn: cfg.labelEn,
        description: cfg.description,
        connectorCount: cfg.connectors.length,
    }));
}
