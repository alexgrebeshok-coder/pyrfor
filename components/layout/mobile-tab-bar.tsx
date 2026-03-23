"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Workflow,
} from "lucide-react";

import { useLocale } from "@/contexts/locale-context";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { href: "/projects", icon: BriefcaseBusiness, labelKey: "nav.projects" },
  { href: "/tasks", icon: Workflow, labelKey: "nav.tasks" },
  { href: "/chat", icon: MessageSquareText, labelKey: "nav.chat" },
] as const;

export function MobileTabBar({
  pathname,
  onOpenMenu,
}: {
  pathname: string;
  onOpenMenu: () => void;
}) {
  const { locale, t } = useLocale();

  const moreLabel = locale === "ru" ? "Ещё" : locale === "zh" ? "更多" : "More";

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-[color:var(--line-strong)] bg-[color:var(--surface-panel)]/96 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur-md sm:hidden"
    >
      <div className="grid grid-cols-5 gap-1 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),0px)]">
        {tabs.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium leading-none transition",
                active
                  ? "bg-[var(--brand)]/12 text-[var(--brand)]"
                  : "text-[var(--ink-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]"
              )}
              href={item.href}
              key={item.href}
              prefetch={false}
            >
              <Icon className={cn("h-5 w-5 shrink-0", active && "scale-105")} />
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          );
        })}

        <button
          aria-label={moreLabel}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium leading-none text-[var(--ink-muted)] transition hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]"
          onClick={onOpenMenu}
          type="button"
        >
          <Menu className="h-5 w-5 shrink-0" />
          <span className="truncate">{moreLabel}</span>
        </button>
      </div>
    </nav>
  );
}
