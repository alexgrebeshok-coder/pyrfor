/**
 * Regional provider profiles — preset connector configurations per region
 */
export type RegionProfile = "russia" | "global_smb" | "global_enterprise" | "hybrid";
export interface ProfileConfig {
    label: string;
    labelEn: string;
    connectors: string[];
    defaultMapProvider: string | undefined;
    defaultCalendarProvider: string | undefined;
    defaultFinanceProvider: string | undefined;
    currency: string | undefined;
    locale: string | undefined;
    timezone: string | undefined;
    description: string;
}
export declare const REGION_PROFILES: Record<RegionProfile, ProfileConfig>;
/**
 * Get recommended connectors for a profile
 */
export declare function getProfileConnectors(profile: RegionProfile): string[];
/**
 * Get all profile options for onboarding UI
 */
export declare function getProfileOptions(): Array<{
    id: RegionProfile;
    label: string;
    labelEn: string;
    description: string;
    connectorCount: number;
}>;
//# sourceMappingURL=profiles.d.ts.map