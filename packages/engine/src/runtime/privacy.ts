/**
 * Privacy Zones — Data isolation and security levels
 *
 * Features:
 * - Each tool/action has a privacy zone
 * - Personal data stays in personal zone
 * - Vault = encrypted, only accessible with explicit permission
 */

import { logger } from '../observability/logger';

// ============================================
// Types
// ============================================

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
  vaultPassword?: string; // Only used in vault zone
}

/** Privacy check result */
export interface PrivacyCheck {
  allowed: boolean;
  zone: PrivacyZone;
  reason?: string;
}

// ============================================
// Zone Definitions
// ============================================

/** Public data - can be shared, logged, used in training */
export const PUBLIC_ZONE: DataClassification = {
  zone: 'public',
  encrypted: false,
  requiresAuth: false,
  allowedTools: ['web_search', 'web_fetch', 'send_message'],
};

/** Personal data - private to user, not logged or shared */
export const PERSONAL_ZONE: DataClassification = {
  zone: 'personal',
  encrypted: false,
  requiresAuth: true,
  allowedTools: ['read_file', 'write_file', 'edit_file', 'send_message'],
};

/** Vault data - encrypted, requires explicit unlock */
export const VAULT_ZONE: DataClassification = {
  zone: 'vault',
  encrypted: true,
  requiresAuth: true,
  allowedTools: ['read_file', 'send_message'], // Limited toolset
};

// ============================================
// Privacy Manager
// ============================================

export class PrivacyManager {
  private policy: PrivacyPolicy;
  private vaultUnlocked = false;
  private vaultUnlockTime?: Date;
  private readonly vaultTimeoutMs = 5 * 60 * 1000; // 5 minute timeout

  constructor(policy: Partial<PrivacyPolicy> = {}) {
    this.policy = {
      defaultZone: 'personal',
      toolZones: new Map(),
      ...policy,
    };

    // Set default tool zones
    this.policy.toolZones.set('web_search', 'public');
    this.policy.toolZones.set('web_fetch', 'public');
    this.policy.toolZones.set('send_message', 'personal');
    this.policy.toolZones.set('read_file', 'personal');
    this.policy.toolZones.set('write_file', 'personal');
    this.policy.toolZones.set('edit_file', 'personal');
    this.policy.toolZones.set('exec', 'personal');
    this.policy.toolZones.set('browser', 'personal');
  }

  /**
   * Get zone for a tool
   */
  getToolZone(toolName: string): PrivacyZone {
    return this.policy.toolZones.get(toolName) || this.policy.defaultZone;
  }

  /**
   * Set zone for a tool
   */
  setToolZone(toolName: string, zone: PrivacyZone): void {
    this.policy.toolZones.set(toolName, zone);
  }

  /**
   * Check if an operation is allowed
   */
  check(toolName: string, dataZone?: PrivacyZone): PrivacyCheck {
    const toolZone = this.getToolZone(toolName);
    const targetZone = dataZone || toolZone;

    // Public is always allowed
    if (targetZone === 'public') {
      return { allowed: true, zone: 'public' };
    }

    // Check vault access
    if (targetZone === 'vault') {
      if (!this.isVaultUnlocked()) {
        return {
          allowed: false,
          zone: 'vault',
          reason: 'Vault is locked. Explicit permission required.',
        };
      }
      return { allowed: true, zone: 'vault' };
    }

    // Personal zone requires auth
    if (targetZone === 'personal') {
      // In a real implementation, we'd check session auth here
      return { allowed: true, zone: 'personal' };
    }

    // Tool zone restrictions
    if (this.restrictToolInZone(toolName, targetZone)) {
      return {
        allowed: false,
        zone: targetZone,
        reason: `${toolName} is not allowed in ${targetZone} zone`,
      };
    }

    return { allowed: true, zone: targetZone };
  }

  /**
   * Unlock vault with password
   */
  unlockVault(password: string): boolean {
    if (!this.policy.vaultPassword) {
      logger.warn('Vault unlock attempted but no password is set');
      return false;
    }

    // In production, use proper hashing (bcrypt, argon2)
    // This is a simplified check
    if (password === this.policy.vaultPassword) {
      this.vaultUnlocked = true;
      this.vaultUnlockTime = new Date();
      logger.info('Vault unlocked');
      return true;
    }

    logger.warn('Vault unlock failed: incorrect password');
    return false;
  }

  /**
   * Lock vault
   */
  lockVault(): void {
    this.vaultUnlocked = false;
    this.vaultUnlockTime = undefined;
    logger.info('Vault locked');
  }

  /**
   * Check if vault is currently unlocked
   */
  isVaultUnlocked(): boolean {
    if (!this.vaultUnlocked) return false;

    // Check timeout
    if (this.vaultUnlockTime) {
      const elapsed = Date.now() - this.vaultUnlockTime.getTime();
      if (elapsed > this.vaultTimeoutMs) {
        logger.info('Vault auto-locked due to timeout');
        this.lockVault();
        return false;
      }
    }

    return true;
  }

  /**
   * Classify data based on content analysis
   */
  classifyContent(content: string): DataClassification {
    // Check for vault indicators
    if (this.containsVaultIndicators(content)) {
      return VAULT_ZONE;
    }

    // Check for personal data indicators
    if (this.containsPersonalData(content)) {
      return PERSONAL_ZONE;
    }

    return PUBLIC_ZONE;
  }

  /**
   * Sanitize content for a zone
   * Removes sensitive data when downgrading zones
   */
  sanitizeForZone(content: string, targetZone: PrivacyZone): string {
    if (targetZone === 'vault') {
      return content; // No change for vault
    }

    if (targetZone === 'personal') {
      // Remove vault-only markers
      return content
        .replace(/\[VAULT\][\s\S]*?\[\/VAULT\]/gi, '[Encrypted content removed]')
        .replace(/vault:\/\/[^\s]+/gi, '[vault link]');
    }

    if (targetZone === 'public') {
      // Remove both personal and vault content
      return content
        .replace(/\[VAULT\][\s\S]*?\[\/VAULT\]/gi, '[Encrypted content removed]')
        .replace(/\[PRIVATE\][\s\S]*?\[\/PRIVATE\]/gi, '[Private content removed]')
        .replace(/vault:\/\/[^\s]+/gi, '[vault link]')
        .replace(/personal:\/\/[^\s]+/gi, '[personal link]');
    }

    return content;
  }

  /**
   * Get effective zone for operation
   */
  getEffectiveZone(dataZone: PrivacyZone, operationZone: PrivacyZone): PrivacyZone {
    // Most restrictive wins
    if (dataZone === 'vault' || operationZone === 'vault') return 'vault';
    if (dataZone === 'personal' || operationZone === 'personal') return 'personal';
    return 'public';
  }

  /**
   * Check if tool is restricted in a zone
   */
  private restrictToolInZone(toolName: string, zone: PrivacyZone): boolean {
    const zoneDef = zone === 'public' ? PUBLIC_ZONE :
                    zone === 'personal' ? PERSONAL_ZONE : VAULT_ZONE;

    return !zoneDef.allowedTools.includes(toolName);
  }

  /**
   * Check content for vault indicators
   */
  private containsVaultIndicators(content: string): boolean {
    const vaultPatterns = [
      /\[VAULT\]/i,
      /vault:/i,
      /\b(password|secret|key|token)\s*[=:]\s*\S+/i,
      /\b(dob|ssn|passport)\s*[=:]\s*\S+/i,
    ];

    return vaultPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check content for personal data indicators
   */
  private containsPersonalData(content: string): boolean {
    const personalPatterns = [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i, // Email
      /\b\+?\d[\d\s-]{7,}\d\b/, // Phone
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // IP
      /personal:/i,
      /\[PRIVATE\]/i,
    ];

    return personalPatterns.some(pattern => pattern.test(content));
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Create a privacy-aware logger wrapper
 * Logs are filtered based on zone
 */
export function createPrivateLogger(zone: PrivacyZone) {
  const manager = new PrivacyManager();

  return {
    debug: (msg: string, meta?: Record<string, unknown>) => {
      if (zone !== 'vault') {
        logger.debug(msg, meta ? sanitizeMeta(meta, zone) : undefined);
      }
    },
    info: (msg: string, meta?: Record<string, unknown>) => {
      if (zone !== 'vault') {
        logger.info(msg, meta ? sanitizeMeta(meta, zone) : undefined);
      }
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      // Warnings can be logged, but sanitize
      logger.warn(msg, meta ? sanitizeMeta(meta, zone) : undefined);
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      // Errors always logged, but with minimal context in vault
      if (zone === 'vault') {
        logger.error(msg, { zone: 'vault' });
      } else {
        logger.error(msg, meta ? sanitizeMeta(meta, zone) : undefined);
      }
    },
  };
}

/**
 * Sanitize metadata for logging
 */
function sanitizeMeta(
  meta: Record<string, unknown>,
  targetZone: PrivacyZone,
  seen = new Set<object>(),
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'bigint') {
      sanitized[key] = value.toString();
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, targetZone);
    } else if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        sanitized[key] = '[Circular]';
      } else {
        seen.add(value);
        sanitized[key] = sanitizeMeta(value as Record<string, unknown>, targetZone, seen);
        seen.delete(value);
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Check if key is sensitive
 */
function isSensitiveKey(key: string): boolean {
  const sensitiveKeys = [
    'password', 'secret', 'token', 'key', 'auth',
    'passwd', 'pwd', 'credential', 'apikey', 'api_key',
  ];
  return sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
}

/**
 * Sanitize string value
 */
function sanitizeString(value: string, targetZone: PrivacyZone): string {
  // Mask emails — /i flag required so lowercase TLDs (e.g. .com, .org) are matched
  let sanitized = value.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
    '[EMAIL]'
  );

  // Mask phone numbers
  sanitized = sanitized.replace(
    /\b\+?\d[\d\s-]{7,}\d\b/g,
    '[PHONE]'
  );

  if (targetZone === 'public') {
    // More aggressive sanitization for public
    sanitized = sanitized.replace(
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      '[CARD]'
    );
  }

  return sanitized;
}

// ============================================
// Export constants (PRIVATE_ZONE objects are already exported at declaration)
// ============================================
