"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { readClientAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import {
  getAvailableWorkspacesForRole,
  resolveAccessibleWorkspace,
  type PolicyWorkspaceOption,
} from "@/lib/policy/access";
import { isPublicAppPath } from "@/lib/public-paths";
import type { Locale, MessageKey } from "@/lib/translations";
import { AppPreferences, defaultAppPreferences, isLocale } from "@/lib/preferences";

export const PREFERENCES_STORAGE_KEY = "ceoclaw-settings";

export type WorkspaceOption = PolicyWorkspaceOption & {
  nameKey: MessageKey;
  descriptionKey: MessageKey;
};

interface PreferencesContextValue {
  accessProfile: AccessProfile;
  preferences: AppPreferences;
  availableWorkspaces: WorkspaceOption[];
  activeWorkspace: WorkspaceOption;
  setWorkspaceId: (workspaceId: string) => void;
  setCompactMode: (compactMode: boolean) => void;
  setDesktopNotifications: (enabled: boolean) => void;
  setSoundEffects: (enabled: boolean) => void;
  setEmailDigest: (enabled: boolean) => void;
  setAiResponseLocale: (locale: Locale) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = error.code;
  return typeof code === "string" ? code : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isExpectedSettingsLoadError(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    isAbortError(error) ||
    code === "DATABASE_SCHEMA_UNAVAILABLE" ||
    code === "DATABASE_CONNECTION_UNAVAILABLE"
  );
}

function normalizePreferences(
  raw: unknown,
  availableWorkspaces: WorkspaceOption[],
  fallbackWorkspaceId: string
): AppPreferences {
  if (!raw || typeof raw !== "object") {
    return { ...defaultAppPreferences, workspaceId: fallbackWorkspaceId };
  }

  const candidate = raw as Partial<AppPreferences>;
  const workspaceId =
    typeof candidate.workspaceId === "string" &&
    availableWorkspaces.some((item) => item.id === candidate.workspaceId)
      ? candidate.workspaceId
      : fallbackWorkspaceId;

  return {
    workspaceId,
    compactMode: Boolean(candidate.compactMode),
    desktopNotifications:
      typeof candidate.desktopNotifications === "boolean"
        ? candidate.desktopNotifications
        : defaultAppPreferences.desktopNotifications,
    soundEffects:
      typeof candidate.soundEffects === "boolean"
        ? candidate.soundEffects
        : defaultAppPreferences.soundEffects,
    emailDigest:
      typeof candidate.emailDigest === "boolean"
        ? candidate.emailDigest
        : defaultAppPreferences.emailDigest,
    aiResponseLocale: isLocale(candidate.aiResponseLocale)
      ? candidate.aiResponseLocale
      : defaultAppPreferences.aiResponseLocale,
  };
}

function applyDensity(compactMode: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = compactMode ? "compact" : "comfortable";
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isPublicPage = isPublicAppPath(pathname);
  const initialAccessProfile = readClientAccessProfile();
  const initialWorkspaceId = resolveAccessibleWorkspace(
    initialAccessProfile.role,
    initialAccessProfile.workspaceId
  ).id;

  const [accessProfile, setAccessProfile] = useState<AccessProfile>(initialAccessProfile);
  const [preferences, setPreferences] = useState<AppPreferences>(() => ({
    ...defaultAppPreferences,
    workspaceId: initialWorkspaceId,
  }));
  const [isReady, setIsReady] = useState(false);
  const migrationRef = useRef<AppPreferences | null>(null);
  const skipPersistRef = useRef(true);

  useEffect(() => {
    const nextAccessProfile = readClientAccessProfile();
    const availableWorkspaces = getAvailableWorkspacesForRole(nextAccessProfile.role);
    const fallbackWorkspaceId = resolveAccessibleWorkspace(
      nextAccessProfile.role,
      nextAccessProfile.workspaceId
    ).id;

    let nextPreferences = normalizePreferences(
      {},
      availableWorkspaces,
      fallbackWorkspaceId
    );

    try {
      const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        nextPreferences = normalizePreferences(parsed, availableWorkspaces, fallbackWorkspaceId);
        migrationRef.current = nextPreferences;
      }
    } catch {
      // Ignore invalid local storage payloads
    }

    setAccessProfile(nextAccessProfile);
    setPreferences(nextPreferences);
  }, []);

  useEffect(() => {
    if (isPublicPage) {
      setIsReady(true);
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    const availableWorkspaces = getAvailableWorkspacesForRole(accessProfile.role);
    const fallbackWorkspaceId = resolveAccessibleWorkspace(
      accessProfile.role,
      accessProfile.workspaceId
    ).id;

    async function loadSettings() {
      skipPersistRef.current = true;
      try {
        const response = await fetch("/api/settings", { signal: controller.signal });
        const payload = (await response.json()) as
          | {
              persisted?: boolean;
              preferences?: unknown;
              error?: { code?: string; message?: string };
            }
          | undefined;

        if (!response.ok) {
          const error = new Error(payload?.error?.message ?? "Failed to load preferences");
          const code = payload?.error?.code;
          if (code) {
            Object.assign(error, { code });
          }
          throw error;
        }

        const normalized = normalizePreferences(
          payload?.preferences,
          availableWorkspaces,
          fallbackWorkspaceId
        );
        if (!isActive) return;

        setPreferences(normalized);

        if (!payload?.persisted && migrationRef.current) {
          await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(migrationRef.current),
          });
          localStorage.removeItem(PREFERENCES_STORAGE_KEY);
          migrationRef.current = null;
        }
      } catch (error) {
        if (!isExpectedSettingsLoadError(error)) {
          console.error("[PreferencesProvider] Failed to load settings", error);
        }
      } finally {
        if (isActive) {
          setIsReady(true);
        }
      }
    }

    loadSettings();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [accessProfile.role, accessProfile.workspaceId, isPublicPage]);

  useEffect(() => {
    applyDensity(preferences.compactMode);
  }, [preferences.compactMode]);

  useEffect(() => {
    if (!isReady || isPublicPage) return;

    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // ignore storage failures
    }
  }, [isPublicPage, isReady, preferences]);

  useEffect(() => {
    if (!isReady || isPublicPage) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }

    const controller = new AbortController();

    async function persistSettings() {
      try {
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preferences),
            signal: controller.signal,
        });
      } catch (error) {
        if (!isExpectedSettingsLoadError(error)) {
          console.error("[PreferencesProvider] Failed to persist settings", error);
        }
      }
    }

    persistSettings();

    return () => {
      controller.abort();
    };
  }, [isPublicPage, isReady, preferences]);

  const value = useMemo<PreferencesContextValue>(() => {
    const availableWorkspaces = getAvailableWorkspacesForRole(accessProfile.role);
    const activeWorkspace =
      availableWorkspaces.find((item) => item.id === preferences.workspaceId) ??
      availableWorkspaces[0];

    return {
      accessProfile,
      preferences,
      availableWorkspaces,
      activeWorkspace,
      setWorkspaceId: (workspaceId) => {
        if (!availableWorkspaces.some((item) => item.id === workspaceId)) return;
        setPreferences((current) => ({ ...current, workspaceId }));
      },
      setCompactMode: (compactMode) => {
        setPreferences((current) => ({ ...current, compactMode }));
      },
      setDesktopNotifications: (desktopNotifications) => {
        setPreferences((current) => ({ ...current, desktopNotifications }));
      },
      setSoundEffects: (soundEffects) => {
        setPreferences((current) => ({ ...current, soundEffects }));
      },
      setEmailDigest: (emailDigest) => {
        setPreferences((current) => ({ ...current, emailDigest }));
      },
      setAiResponseLocale: (aiResponseLocale) => {
        setPreferences((current) => ({ ...current, aiResponseLocale }));
      },
    };
  }, [accessProfile, preferences]);

  return (
    <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }

  return context;
}
