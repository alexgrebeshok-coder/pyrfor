"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Command, Database, LifeBuoy, MessageSquareText, Search, Sparkles } from "lucide-react";

import { HelpCard } from "@/components/help/help-card";
import { HelpLink } from "@/components/help/help-link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import type { MessageKey } from "@/lib/translations";

const shortcuts = [
  { id: "search", command: "⌘K", key: "help.shortcut.search" as MessageKey },
  { id: "send", command: "⌘↵", key: "help.shortcut.send" as MessageKey },
  { id: "close", command: "Esc", key: "help.shortcut.close" as MessageKey },
  { id: "sidebar", command: "⌘/", key: "help.shortcut.sidebar" as MessageKey },
];

const faqItems = [
  { id: "projects", category: "Начало работы", title: "Как создать проект?", href: "/projects" },
  { id: "tasks", category: "Начало работы", title: "Как управлять задачами?", href: "/tasks" },
  { id: "kanban", category: "Рабочий процесс", title: "Как использовать канбан-доску?", href: "/kanban" },
  { id: "gantt", category: "Рабочий процесс", title: "Как посмотреть диаграмму Ганта?", href: "/gantt" },
  { id: "risks", category: "Управление рисками", title: "Как добавить риски?", href: "/risks" },
  { id: "analytics", category: "Аналитика", title: "Как посмотреть аналитику?", href: "/analytics" },
  { id: "export", category: "Экспорт", title: "Как экспортировать данные?", href: "/" },
  { id: "chat", category: "AI функции", title: "Как использовать AI-чат?", href: "/chat" },
];

export function HelpPage() {
  const { t } = useLocale();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredFaq = useMemo(() => {
    if (!searchQuery.trim()) return faqItems;
    const query = searchQuery.toLowerCase();
    return faqItems.filter(
      item =>
        item.title.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  return (
    <div className="grid gap-4">
      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              className={`${fieldStyles} w-full pl-10`}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("help.searchPlaceholder") || "Search help topics..."}
              type="text"
              value={searchQuery}
            />
          </div>
          {searchQuery && (
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {filteredFaq.length} результат{filteredFaq.length === 1 ? "" : filteredFaq.length > 1 && filteredFaq.length < 5 ? "а" : "ов"}
            </p>
          )}
        </CardContent>
      </Card>

      {/* FAQ Results */}
      {searchQuery && filteredFaq.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-4 font-semibold text-[var(--ink)]">Быстрые ссылки</h3>
            <div className="grid gap-2">
              {filteredFaq.map((item) => (
                <Link
                  className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-3 transition hover:bg-[var(--surface-panel)]"
                  href={item.href}
                  key={item.id}
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--ink)]">{item.title}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{item.category}</p>
                  </div>
                  <span className="text-xs text-[var(--ink-muted)]">→</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Card className="overflow-hidden">
          <CardContent className="grid gap-4 p-6 lg:grid-cols-[1.15fr_.85fr]">
            <div className="space-y-4">
              <span className="inline-flex items-center rounded-[6px] bg-[var(--panel-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                {t("page.help.eyebrow")}
              </span>
              <div>
                <h2 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
                  {t("page.help.title")}
                </h2>
                <p className="mt-3 max-w-2xl text-sm text-[var(--ink-soft)]">
                  {t("help.supportDescription")}
                </p>
              </div>
            </div>
            <div className="grid gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] p-5">
              {shortcuts.map((shortcut) => (
                <div
                  className="flex items-center justify-between rounded-[8px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3"
                  key={shortcut.id}
                >
                  <span className="text-sm text-[var(--ink-soft)]">{t(shortcut.key)}</span>
                  <span className="rounded-[6px] border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-1 text-xs font-semibold text-[var(--ink)]">
                    {shortcut.command}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <HelpCard
          className="overflow-hidden"
          description={t("help.gettingStartedDescription")}
          title={t("help.gettingStartedTitle")}
        >
          <div className="grid gap-3">
            <HelpLink
              description="Find the web app, macOS shell, and iPhone install path in one place."
              href="/release"
              label="Open Release Center"
            />
            <HelpLink
              description={t("help.link.projectsDescription")}
              href="/projects"
              label={t("help.link.projects")}
            />
            <HelpLink
              description={t("help.link.chatDescription")}
              href="/chat"
              label={t("help.link.chat")}
            />
            <HelpLink
              description={t("help.link.settingsDescription")}
              href="/settings"
              label={t("help.link.settings")}
            />
          </div>
        </HelpCard>
      </section>

      <section className="grid gap-4 2xl:grid-cols-2">
        <HelpCard description={t("help.shortcutsDescription")} title={t("help.shortcutsTitle")}>
          <div className="grid gap-3">
            {shortcuts.map((shortcut) => (
              <div
                className="flex items-center justify-between rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3"
                key={shortcut.id}
              >
                <span className="text-sm font-medium text-[var(--ink)]">{t(shortcut.key)}</span>
                <span className="rounded-[6px] bg-[var(--surface-panel-strong)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                  {shortcut.command}
                </span>
              </div>
            ))}
          </div>
        </HelpCard>

        <HelpCard description={t("help.aiDescription")} title={t("help.aiTitle")}>
          <div className="grid gap-3">
            <div className="rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--panel-soft-strong)] text-[var(--brand)]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">{t("nav.chat")}</p>
                  <p className="text-sm text-[var(--ink-muted)]">{t("help.aiDescription")}</p>
                </div>
              </div>
            </div>
            <HelpLink
              description={t("help.link.chatDescription")}
              href="/chat"
              label={t("help.link.chat")}
            />
          </div>
        </HelpCard>

        <HelpCard description={t("help.storageDescription")} title={t("help.storageTitle")}>
          <div className="grid gap-3">
            <div className="flex items-start gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--panel-soft-strong)] text-[var(--brand)]">
                <Database className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">{t("help.storageTitle")}</p>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{t("help.storageDescription")}</p>
              </div>
            </div>
          </div>
        </HelpCard>

        <HelpCard description={t("help.supportDescription")} title={t("help.supportTitle")}>
          <div className="grid gap-3">
            <HelpLink
              description={t("help.link.settingsDescription")}
              href="/settings"
              label={t("help.link.settings")}
            />
            <HelpLink
              description={t("help.link.projectsDescription")}
              href="/projects"
              label={t("help.link.projects")}
            />
            <div className="rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--panel-soft-strong)] text-[var(--brand)]">
                  <LifeBuoy className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">{t("help.supportStatus")}</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{t("help.supportResponse")}</p>
                </div>
              </div>
            </div>
          </div>
        </HelpCard>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-4 p-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[var(--panel-soft)] text-[var(--brand)]">
              <Command className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold">{t("help.shortcutsTitle")}</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{t("help.shortcutsDescription")}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[var(--panel-soft)] text-[var(--brand)]">
              <MessageSquareText className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold text-[var(--ink)]">{t("help.aiTitle")}</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{t("help.aiDescription")}</p>
            </div>
            <Link className={buttonVariants({ variant: "secondary" })} href="/chat">
              {t("help.link.chat")}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[var(--panel-soft)] text-[var(--brand)]">
              <LifeBuoy className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold text-[var(--ink)]">{t("help.supportTitle")}</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{t("help.supportResponse")}</p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
