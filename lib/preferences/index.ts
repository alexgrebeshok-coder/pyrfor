import type { Locale } from "@/lib/translations";

export interface AppPreferences {
  workspaceId: string;
  compactMode: boolean;
  desktopNotifications: boolean;
  soundEffects: boolean;
  emailDigest: boolean;
  aiResponseLocale: Locale;
}

export const supportedLocales = ["ru", "en", "zh"] as const;

export const defaultAppPreferences: AppPreferences = {
  workspaceId: "delivery",
  compactMode: true,
  desktopNotifications: true,
  soundEffects: false,
  emailDigest: true,
  aiResponseLocale: "ru",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (supportedLocales as readonly Locale[]).includes(value as Locale);
}
