"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { BellRing, Bot, CreditCard, Download, MonitorCog, RefreshCcw, Wrench } from "lucide-react";
import { toast } from "sonner";

import { AIProviderSelector } from "@/components/settings/ai-provider-selector";
import { LanguageSelector } from "@/components/settings/language-selector";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsDivider } from "@/components/settings/settings-divider";
import { SettingsItem } from "@/components/settings/settings-item";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { ToggleSwitch } from "@/components/settings/toggle-switch";
import { YandexIntegration } from "@/components/settings/yandex-integration";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import {
  PREFERENCES_STORAGE_KEY,
  usePreferences,
} from "@/contexts/preferences-context";
import { useTheme } from "@/contexts/theme-context";
import { defaultAppPreferences } from "@/lib/preferences";
import { localeOptions, type MessageKey } from "@/lib/translations";
import { buttonVariants } from "@/components/ui/button";

const RESET_KEYS = [
  "ceoclaw_cache",
  "pm-dashboard-state-v1",
  "ceoclaw-chat-sessions-v1",
  "ceoclaw-chat-sidebar-sections-v1",
  "ceoclaw-ai-agent",
  "ceoclaw-ai-mode",
];

export function SettingsPage() {
  const { locale, setLocale, t } = useLocale();
  const { setTheme, theme, resolvedTheme } = useTheme();
  const { preferredMode } = useAIWorkspace();
  const {
    activeWorkspace,
    availableWorkspaces,
    preferences,
    setAiResponseLocale,
    setCompactMode,
    setDesktopNotifications,
    setEmailDigest,
    setSoundEffects,
    setWorkspaceId,
  } = usePreferences();
  const workspaceFieldId = useId();

  const activeThemeLabel = useMemo(() => {
    if (theme === "system") {
      return `${t("theme.system")} · ${resolvedTheme === "dark" ? t("theme.dark") : t("theme.light")}`;
    }

    return theme === "dark" ? t("theme.dark") : t("theme.light");
  }, [resolvedTheme, t, theme]);
  const aiModeKey = `settings.mode.${preferredMode}` as MessageKey;

  const exportLocalState = () => {
    try {
      const snapshot = {
        exportedAt: new Date().toISOString(),
        locale,
        theme,
        preferences,
        storage: Object.fromEntries(
          Object.keys(window.localStorage)
            .filter((key) => key.startsWith("ceoclaw") || key.startsWith("pm-dashboard"))
            .map((key) => [key, window.localStorage.getItem(key)])
        ),
      };

      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `ceoclaw-local-state-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);

      toast.success(t("toast.settingsExported"), {
        description: t("toast.settingsExportedDesc"),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.aiRunFailedDesc")
      );
    }
  };

  const sendTestNotification = async () => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      toast.error(t("toast.notificationsUnavailable"), {
        description: t("toast.notificationsUnavailableDesc"),
      });
      return;
    }

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") {
      toast.error(t("toast.notificationsDenied"), {
        description: t("toast.notificationsDeniedDesc"),
      });
      return;
    }

    new Notification(t("settings.notificationPreviewTitle"), {
      body: t("settings.notificationPreviewBody"),
    });

    toast.success(t("toast.notificationsTested"), {
      description: t("toast.notificationsTestedDesc"),
    });
  };

  const resetOperationalState = async () => {
    try {
      if (!window.confirm(t("settings.resetConfirm"))) {
        return;
      }

      const resetPreferences = {
        workspaceId: defaultAppPreferences.workspaceId,
        compactMode: defaultAppPreferences.compactMode,
        desktopNotifications: defaultAppPreferences.desktopNotifications,
        soundEffects: defaultAppPreferences.soundEffects,
        emailDigest: defaultAppPreferences.emailDigest,
        aiResponseLocale: defaultAppPreferences.aiResponseLocale,
      };

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(resetPreferences),
      });

      if (!response.ok) {
        throw new Error(t("toast.localStateResetDesc"));
      }

      setWorkspaceId(resetPreferences.workspaceId);
      setCompactMode(resetPreferences.compactMode);
      setDesktopNotifications(resetPreferences.desktopNotifications);
      setSoundEffects(resetPreferences.soundEffects);
      setEmailDigest(resetPreferences.emailDigest);
      setAiResponseLocale(resetPreferences.aiResponseLocale);
      setTheme("system");
      setLocale(resetPreferences.aiResponseLocale);

      RESET_KEYS.forEach((key) => window.localStorage.removeItem(key));
      window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
      window.localStorage.removeItem("ceoclaw-settings");

      toast.success(t("toast.localStateReset"), {
        description: t("toast.localStateResetDesc"),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.aiRunFailedDesc")
      );
    }
  };

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Card className="overflow-hidden">
          <CardContent className="grid gap-4 p-6 lg:grid-cols-[1.1fr_.9fr]">
            <div className="space-y-4">
              <span className="inline-flex items-center rounded-[6px] bg-[var(--panel-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                {t("page.settings.eyebrow")}
              </span>
              <div>
                <h2 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
                  {t("page.settings.title")}
                </h2>
                <p className="mt-3 max-w-2xl text-sm text-[var(--ink-soft)]">
                  {t("settings.summaryDescription")}
                </p>
              </div>
            </div>

            <div className="grid gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] p-5">
              <div className="flex items-center justify-between rounded-[8px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
                <span className="text-sm text-[var(--ink-soft)]">{t("settings.workspaceLabel")}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">{t(activeWorkspace.nameKey)}</span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
                <span className="text-sm text-[var(--ink-soft)]">{t("settings.themeLabel")}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">{activeThemeLabel}</span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
                <span className="text-sm text-[var(--ink-soft)]">{t("settings.aiModeLabel")}</span>
                <span className="text-sm font-semibold capitalize text-[var(--ink)]">
                  {t(aiModeKey)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <SettingsCard
          className="overflow-hidden"
          description={t("settings.runtimeDescription")}
          title={t("settings.runtimeTitle")}
        >
          <div className="grid gap-3">
            <Button onClick={sendTestNotification} variant="secondary">
              <BellRing className="h-4 w-4" />
              {t("settings.testNotification")}
            </Button>
            <Button onClick={exportLocalState} variant="outline">
              <Download className="h-4 w-4" />
              {t("settings.exportButton")}
            </Button>
            <Link
              className={`${buttonVariants({ variant: "outline" })} w-full`}
              href="/billing"
            >
              <CreditCard className="h-4 w-4" />
              Billing & plans
            </Link>
            <Link
              className={`${buttonVariants({ variant: "outline" })} w-full`}
              href="/help"
            >
              <Wrench className="h-4 w-4" />
              {t("nav.help")}
            </Link>
          </div>
        </SettingsCard>
      </section>

      <section className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <SettingsCard
          description={t("settings.workspaceHelp")}
          title={t("settings.section.workspace")}
        >
          <SettingsItem
            description={t("settings.workspaceHelp")}
            label={t("settings.workspaceLabel")}
          >
            <div className="grid gap-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor={workspaceFieldId}>
                {t("settings.workspaceLabel")}
              </label>
              <select
                className={fieldStyles}
                id={workspaceFieldId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                value={preferences.workspaceId}
              >
                {availableWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {t(workspace.nameKey)}
                  </option>
                ))}
              </select>
            </div>
          </SettingsItem>
        </SettingsCard>

        <SettingsCard
          description={t("settings.appearanceDescription")}
          title={t("settings.section.appearance")}
        >
          <SettingsItem
            description={t("settings.themeHelp")}
            label={t("settings.themeLabel")}
          >
            <ThemeSelector />
          </SettingsItem>
          <SettingsDivider />
          <SettingsItem
            description={t("settings.languageHelp")}
            label={t("settings.languageLabel")}
          >
            <LanguageSelector />
          </SettingsItem>
          <SettingsDivider />
          <SettingsItem
            description={t("settings.compactModeHelp")}
            label={t("settings.compactMode")}
          >
            <div className="flex items-center justify-between gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface-panel-strong)] px-4 py-3">
              <span className="text-sm text-[var(--ink-soft)]">{t("settings.compactMode")}</span>
              <ToggleSwitch
                ariaLabel={t("settings.compactMode")}
                checked={preferences.compactMode}
                onCheckedChange={setCompactMode}
              />
            </div>
          </SettingsItem>
        </SettingsCard>

        <SettingsCard
          description={t("settings.notificationsDescription")}
          title={t("settings.section.notifications")}
        >
          <SettingsItem
            description={t("settings.desktopNotificationsHelp")}
            label={t("settings.desktopNotifications")}
          >
            <div className="flex items-center justify-between gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface-panel-strong)] px-4 py-3">
              <span className="text-sm text-[var(--ink-soft)]">{t("settings.desktopNotifications")}</span>
              <ToggleSwitch
                ariaLabel={t("settings.desktopNotifications")}
                checked={preferences.desktopNotifications}
                onCheckedChange={setDesktopNotifications}
              />
            </div>
          </SettingsItem>
          <SettingsDivider />
          <SettingsItem
            description={t("settings.soundEffectsHelp")}
            label={t("settings.soundEffects")}
          >
            <div className="flex items-center justify-between gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface-panel-strong)] px-4 py-3">
              <span className="text-sm text-[var(--ink-soft)]">{t("settings.soundEffects")}</span>
              <ToggleSwitch
                ariaLabel={t("settings.soundEffects")}
                checked={preferences.soundEffects}
                onCheckedChange={setSoundEffects}
              />
            </div>
          </SettingsItem>
          <SettingsDivider />
          <SettingsItem
            description={t("settings.emailDigestHelp")}
            label={t("settings.emailDigest")}
          >
            <div className="flex items-center justify-between gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface-panel-strong)] px-4 py-3">
              <span className="text-sm text-[var(--ink-soft)]">{t("settings.emailDigest")}</span>
              <ToggleSwitch
                ariaLabel={t("settings.emailDigest")}
                checked={preferences.emailDigest}
                onCheckedChange={setEmailDigest}
              />
            </div>
          </SettingsItem>
        </SettingsCard>

        <SettingsCard description={t("settings.aiModeHelp")} title={t("settings.section.ai")}>
          <SettingsItem
            description={t("settings.aiModeHelp")}
            label={t("settings.aiModeLabel")}
          >
            <AIProviderSelector />
          </SettingsItem>
          <SettingsDivider />
          <SettingsItem
            description={t("settings.aiResponseLanguageHelp")}
            label={t("settings.aiResponseLanguageLabel")}
          >
            <div className="flex flex-wrap gap-2">
              {localeOptions.map((option) => (
                <Button
                  key={option.code}
                  onClick={() => setAiResponseLocale(option.code)}
                  variant={
                    preferences.aiResponseLocale === option.code ? "secondary" : "outline"
                  }
                >
                  <span>{option.emoji}</span>
                  {option.short}
                </Button>
              ))}
            </div>
          </SettingsItem>
        </SettingsCard>

        <YandexIntegration />

        <SettingsCard description={t("settings.dataExportHelp")} title={t("settings.section.data")}>
          <SettingsItem
            description={t("settings.dataExportHelp")}
            label={t("settings.dataExport")}
          >
            <Button className="w-full justify-center" onClick={exportLocalState} variant="secondary">
              <Download className="h-4 w-4" />
              {t("settings.exportButton")}
            </Button>
          </SettingsItem>
          <SettingsDivider />
          <SettingsItem
            description={t("settings.resetLocalStateHelp")}
            label={t("settings.resetLocalState")}
          >
            <Button className="w-full justify-center" onClick={() => void resetOperationalState()} variant="outline">
              <RefreshCcw className="h-4 w-4" />
              {t("settings.resetButton")}
            </Button>
          </SettingsItem>
        </SettingsCard>

        <Card className="overflow-hidden">
          <CardContent className="grid gap-4 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-[var(--panel-soft)] text-[var(--brand)]">
                <MonitorCog className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">{t("settings.runtimeTitle")}</p>
                <p className="text-sm text-[var(--ink-muted)]">{t("settings.runtimeDescription")}</p>
              </div>
            </div>
            <div className="grid gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--ink-soft)]">{t("settings.aiModeLabel")}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">{t(aiModeKey)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--ink-soft)]">{t("settings.aiResponseLanguageLabel")}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">
                  {localeOptions.find((option) => option.code === preferences.aiResponseLocale)?.label}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--ink-soft)]">{t("settings.compactMode")}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">
                  {preferences.compactMode ? t("misc.enabled") : t("misc.disabled")}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className={buttonVariants({ variant: "secondary" })} href="/chat">
                <Bot className="h-4 w-4" />
                {t("nav.chat")}
              </Link>
              <Link className={buttonVariants({ variant: "outline" })} href="/projects">
                <MonitorCog className="h-4 w-4" />
                {t("nav.projects")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
