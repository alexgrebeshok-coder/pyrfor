/**
 * Privacy Zones — Data isolation and security levels
 *
 * Features:
 * - Each tool/action has a privacy zone
 * - Personal data stays in personal zone
 * - Vault = encrypted, only accessible with explicit permission
 */
/** Privacy zone levels */
export type PrivacyZone = 'public' | 'personal' | 'vault';
/** Data classification for content */
export interface DataClassification {
    zone: PrivacyZone;
    encrypted?: boolean;
    requiresAuth?: boolean;
    allowedTools: string[];
}
/** Privacy policy for a session */
export interface PrivacyPolicy {
    defaultZone: PrivacyZone;
    toolZones: Map<string, PrivacyZone>;
    vaultPassword?: string;
}
/** Privacy check result */
export interface PrivacyCheck {
    allowed: boolean;
    zone: PrivacyZone;
    reason?: string;
}
/** Public data - can be shared, logged, used in training */
export declare const PUBLIC_ZONE: DataClassification;
/** Personal data - private to user, not logged or shared */
export declare const PERSONAL_ZONE: DataClassification;
/** Vault data - encrypted, requires explicit unlock */
export declare const VAULT_ZONE: DataClassification;
export declare class PrivacyManager {
    private policy;
    private vaultUnlocked;
    private vaultUnlockTime?;
    private readonly vaultTimeoutMs;
    constructor(policy?: Partial<PrivacyPolicy>);
    /**
     * Get zone for a tool
     */
    getToolZone(toolName: string): PrivacyZone;
    /**
     * Set zone for a tool
     */
    setToolZone(toolName: string, zone: PrivacyZone): void;
    /**
     * Check if an operation is allowed
     */
    check(toolName: string, dataZone?: PrivacyZone): PrivacyCheck;
    /**
     * Unlock vault with password
     */
    unlockVault(password: string): boolean;
    /**
     * Lock vault
     */
    lockVault(): void;
    /**
     * Check if vault is currently unlocked
     */
    isVaultUnlocked(): boolean;
    /**
     * Classify data based on content analysis
     */
    classifyContent(content: string): DataClassification;
    /**
     * Sanitize content for a zone
     * Removes sensitive data when downgrading zones
     */
    sanitizeForZone(content: string, targetZone: PrivacyZone): string;
    /**
     * Get effective zone for operation
     */
    getEffectiveZone(dataZone: PrivacyZone, operationZone: PrivacyZone): PrivacyZone;
    /**
     * Check if tool is restricted in a zone
     */
    private restrictToolInZone;
    /**
     * Check content for vault indicators
     */
    private containsVaultIndicators;
    /**
     * Check content for personal data indicators
     */
    private containsPersonalData;
}
/**
 * Create a privacy-aware logger wrapper
 * Logs are filtered based on zone
 */
export declare function createPrivateLogger(zone: PrivacyZone): {
    debug: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
};
//# sourceMappingURL=privacy.d.ts.map