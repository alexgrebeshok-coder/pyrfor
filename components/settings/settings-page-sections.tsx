import Link from "next/link";
import { BellRing, Bot, CreditCard, Download, MonitorCog, Users, Wrench } from "lucide-react";

import { SettingsCard } from "@/components/settings/settings-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MessageKey } from "@/lib/translations";

type SettingsPageTranslator = (key: MessageKey, values?: Record<string, string | number>) => string;

interface SettingsPageOverviewSectionProps {
  activeThemeLabel: string;
  activeWorkspaceLabel: string;
  aiModeLabel: string;
  exportLocalState: () => void;
  sendTestNotification: () => Promise<void> | void;
  t: SettingsPageTranslator;
}

export function SettingsPageOverviewSection({
  activeThemeLabel,
  activeWorkspaceLabel,
  aiModeLabel,
  exportLocalState,
  sendTestNotification,
  t,
}: SettingsPageOverviewSectionProps) {
  return (
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
              <span className="text-sm font-semibold text-[var(--ink)]">{activeWorkspaceLabel}</span>
            </div>
            <div className="flex items-center justify-between rounded-[8px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
              <span className="text-sm text-[var(--ink-soft)]">{t("settings.themeLabel")}</span>
              <span className="text-sm font-semibold text-[var(--ink)]">{activeThemeLabel}</span>
            </div>
            <div className="flex items-center justify-between rounded-[8px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
              <span className="text-sm text-[var(--ink-soft)]">{t("settings.aiModeLabel")}</span>
              <span className="text-sm font-semibold capitalize text-[var(--ink)]">{aiModeLabel}</span>
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
          <Button onClick={() => void sendTestNotification()} variant="secondary">
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
  );
}

interface SettingsPageRuntimeSummaryCardProps {
  aiModeLabel: string;
  aiResponseLanguageLabel: string;
  compactModeEnabled: boolean;
  t: SettingsPageTranslator;
}

export function SettingsPageRuntimeSummaryCard({
  aiModeLabel,
  aiResponseLanguageLabel,
  compactModeEnabled,
  t,
}: SettingsPageRuntimeSummaryCardProps) {
  return (
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
            <span className="text-sm font-semibold text-[var(--ink)]">{aiModeLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--ink-soft)]">{t("settings.aiResponseLanguageLabel")}</span>
            <span className="text-sm font-semibold text-[var(--ink)]">{aiResponseLanguageLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--ink-soft)]">{t("settings.compactMode")}</span>
            <span className="text-sm font-semibold text-[var(--ink)]">
              {compactModeEnabled ? t("misc.enabled") : t("misc.disabled")}
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
          <Link className={buttonVariants({ variant: "outline" })} href="/settings/agents">
            <Users className="h-4 w-4" />
            Agent Orchestration
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
