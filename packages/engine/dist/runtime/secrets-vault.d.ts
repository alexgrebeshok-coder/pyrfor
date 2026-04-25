/**
 * secrets-vault — Local encrypted secrets store using AES-256-GCM + scrypt.
 *
 * Vault file format (VaultSnapshot):
 *   { version:1, salt, iv, algo:'aes-256-gcm', kdf:'scrypt', ciphertext, tag }
 *   All binary fields stored as base64.
 *
 * Security notes:
 *   - Fresh 12-byte IV generated on every flush (salt kept per-session).
 *   - scrypt N=2^14, r=8, p=1, keylen=32 by default.
 *   - Derived key + salt zeroed in memory on lock().
 *   - GCM auth-tag ensures integrity — tampered ciphertext throws on decrypt.
 *   - File writes are atomic (tmp + rename).
 */
export type VaultEntry = {
    id: string;
    name: string;
    value: string;
    tags?: string[];
    createdAt: number;
    updatedAt: number;
    meta?: Record<string, string>;
};
export type VaultSnapshot = {
    version: 1;
    salt: string;
    iv: string;
    algo: 'aes-256-gcm';
    kdf: 'scrypt';
    ciphertext: string;
    tag: string;
};
export type ScryptParams = {
    N: number;
    r: number;
    p: number;
    keylen: number;
};
export type SecretsVaultOpts = {
    storePath: string;
    clock?: () => number;
    logger?: (msg: string, meta?: unknown) => void;
    scryptParams?: Partial<ScryptParams>;
};
export declare function createSecretsVault(opts: SecretsVaultOpts): {
    unlock: (passphrase: string) => Promise<void>;
    lock: () => void;
    isUnlocked: () => boolean;
    changePassphrase: (oldP: string, newP: string) => Promise<void>;
    put: (name: string, value: string, putOpts?: {
        tags?: string[];
        meta?: Record<string, string>;
    }) => VaultEntry;
    get: (name: string) => VaultEntry | undefined;
    getValue: (name: string) => string | undefined;
    list: (filter?: {
        tag?: string;
        namePrefix?: string;
    }) => VaultEntry[];
    remove: (name: string) => boolean;
    rotate: (name: string, newValue: string) => VaultEntry | undefined;
    flush: () => Promise<void>;
    reset: () => Promise<void>;
};
//# sourceMappingURL=secrets-vault.d.ts.map