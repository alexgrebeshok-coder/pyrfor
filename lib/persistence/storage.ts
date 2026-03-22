/**
 * Persistence Layer
 *
 * Unified storage layer that persists data to:
 * 1. localStorage (browser)
 * 2. JSON files (server-side, optional)
 *
 * With migrations, export/import, and auto-sync.
 */

import { logger } from "@/lib/logger";

// ============================================
// Types
// ============================================

export interface StorageOptions {
  /** Key for localStorage */
  key: string;
  /** Default value if not found */
  defaultValue?: any;
  /** Serialize function */
  serialize?: (value: any) => string;
  /** Deserialize function */
  deserialize?: (value: string) => any;
}

export interface PersistenceStats {
  keys: string[];
  size: number;
  lastSync: string | null;
}

// ============================================
// Storage Keys
// ============================================

export const STORAGE_KEYS = {
  // App State
  ONBOARDING: "ceoclaw-onboarding",
  ONBOARDING_COMPLETE: "ceoclaw-onboarding-complete",
  SETTINGS: "ceoclaw-settings",
  THEME: "ceoclaw-theme",
  LOCALE: "ceoclaw-locale",
  
  // Dashboard Data
  PROJECTS: "ceoclaw-projects",
  TASKS: "ceoclaw-tasks",
  TEAM: "ceoclaw-team",
  RISKS: "ceoclaw-risks",
  NOTIFICATIONS: "ceoclaw-notifications",
  
  // AI Data
  AI_RUNS: "ceoclaw-ai-runs",
  AI_HISTORY: "ceoclaw-ai-history",
  AI_SESSION: "ceoclaw-ai-session",
  AI_SETTINGS: "ceoclaw-ai-settings",
  
  // Memory
  MEMORY: "ceoclaw-memory",
  
  // UI State
  SIDEBAR_STATE: "ceoclaw-sidebar-state",
  CHAT_FAB_POSITION: "chat-fab-position",
} as const;

// ============================================
// Schema Version & Migrations
// ============================================

const SCHEMA_VERSION_KEY = "ceoclaw-schema-version";
const CURRENT_VERSION = 1;

interface Migration {
  version: number;
  name: string;
  migrate: () => void;
}

const MIGRATIONS: Migration[] = [
  // Future migrations will be added here
];

// ============================================
// Browser Storage (localStorage)
// ============================================

export const browserStorage = {
  get<T>(key: string, defaultValue?: T): T | null {
    if (typeof window === "undefined") return defaultValue ?? null;
    
    try {
      const item = localStorage.getItem(key);
      if (!item) return defaultValue ?? null;
      return JSON.parse(item) as T;
    } catch (error) {
      logger.error("Storage read error", { key, error: error instanceof Error ? error.message : String(error) });
      return defaultValue ?? null;
    }
  },

  set<T>(key: string, value: T): boolean {
    if (typeof window === "undefined") return false;
    
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error(`[Storage] Error writing "${key}"`, { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  remove(key: string): boolean {
    if (typeof window === "undefined") return false;
    
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      logger.error(`[Storage] Error removing "${key}"`, { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  clear(): boolean {
    if (typeof window === "undefined") return false;
    
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      logger.error("[Storage] Error clearing", { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  getSize(): number {
    if (typeof window === "undefined") return 0;
    
    let size = 0;
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        size += localStorage.getItem(key)?.length || 0;
      }
    }
    return size * 2; // UTF-16 encoding
  },

  getKeys(): string[] {
    if (typeof window === "undefined") return [];
    return Object.keys(localStorage).filter(k => k.startsWith("ceoclaw-"));
  },
};

// ============================================
// Migration System
// ============================================

export function runMigrations(): void {
  if (typeof window === "undefined") return;

  const storedVersion = parseInt(
    localStorage.getItem(SCHEMA_VERSION_KEY) || "0",
    10
  );

  if (storedVersion >= CURRENT_VERSION) {
    logger.info("[Migration] Storage already up to date");
    return;
  }

  logger.info(`[Migration] Running storage migrations ${storedVersion} → ${CURRENT_VERSION}`);

  for (const migration of MIGRATIONS) {
    if (migration.version > storedVersion) {
      logger.info(`[Migration] Running: ${migration.name}`);
      migration.migrate();
    }
  }

  localStorage.setItem(SCHEMA_VERSION_KEY, CURRENT_VERSION.toString());
  logger.info("[Migration] Storage complete");
}

// ============================================
// Data Export/Import
// ============================================

export function exportAllData(): string {
  const data: Record<string, any> = {};
  
  for (const key of Object.values(STORAGE_KEYS)) {
    const value = browserStorage.get(key);
    if (value !== null) {
      data[key] = value;
    }
  }

  return JSON.stringify({
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  }, null, 2);
}

export function importAllData(jsonString: string): boolean {
  try {
    const { version, data } = JSON.parse(jsonString);
    
    if (version > CURRENT_VERSION) {
      logger.warn(`[Import] Data version ${version} is newer than current ${CURRENT_VERSION}`);
    }

    for (const [key, value] of Object.entries(data)) {
      browserStorage.set(key, value);
    }

    logger.info("[Import] Data imported successfully");
    return true;
  } catch (error) {
    logger.error("[Import] Error importing data", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

// ============================================
// Clear Data
// ============================================

export function clearAllData(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    browserStorage.remove(key);
  }
  browserStorage.remove(SCHEMA_VERSION_KEY);
  logger.info("Storage cleared");
}

// ============================================
// Persistence Stats
// ============================================

export function getPersistenceStats(): PersistenceStats {
  const keys = browserStorage.getKeys();
  const size = browserStorage.getSize();
  
  return {
    keys,
    size,
    lastSync: new Date().toISOString(),
  };
}

// ============================================
// Initialize
// ============================================

// Run migrations on load
if (typeof window !== "undefined") {
  // Delay to ensure window is ready
  setTimeout(() => runMigrations(), 0);
}
