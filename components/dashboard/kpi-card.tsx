"use client";

import { memo } from "react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  onClick?: () => void;
}

const toneStyles: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  neutral: "bg-[var(--panel-soft)] text-[var(--brand)]",
  success: "bg-emerald-500/18 text-emerald-100",
  warning: "bg-amber-500/18 text-amber-100",
  danger: "bg-rose-500/18 text-rose-100",
};

function KpiCardComponent({
  title,
  value,
  description,
  icon,
  tone = "neutral",
  onClick,
}: KpiCardProps) {
  const isClickable = Boolean(onClick);

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        isClickable && "cursor-pointer transition-all hover:bg-muted active:scale-[0.98] focus:ring-2"
      )}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `${title}: ${value}. ${description}. Click for details.` : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <CardContent className="relative flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--ink-soft)]">{title}</p>
            <p className="mt-4 font-heading text-xl md:text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {value}
            </p>
          </div>
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-[10px]", toneStyles[tone])}>
            {icon}
          </div>
        </div>
        <p className="text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
      </CardContent>
    </Card>
  );
}

export const KpiCard = memo(KpiCardComponent);
