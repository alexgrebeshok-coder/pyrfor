// @ochag/family — Family vault helpers (encryption wrappers)
// NOTE: Actual encryption is done server-side with AES-256-GCM.
// These helpers deal with the data envelope only.

import type { VaultCategory } from './types'

export interface VaultPayload {
  category: VaultCategory
  title: string
  fields: Record<string, string>
}

/**
 * Deserialize vault entry data (after server-side decryption).
 */
export function parseVaultPayload(json: string): VaultPayload {
  try {
    return JSON.parse(json) as VaultPayload
  } catch {
    throw new Error('VaultEntry: malformed payload JSON')
  }
}

/**
 * Serialize vault payload for storage (before server-side encryption).
 */
export function serializeVaultPayload(payload: VaultPayload): string {
  return JSON.stringify(payload)
}

/**
 * Returns a display-safe summary (no sensitive field values).
 */
export function vaultSummary(payload: VaultPayload): { category: VaultCategory; title: string; fieldCount: number } {
  return {
    category: payload.category,
    title: payload.title,
    fieldCount: Object.keys(payload.fields).length,
  }
}
