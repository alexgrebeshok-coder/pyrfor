"use client";

import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/contexts/locale-context";

export interface KpiBreakdownItem {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  tone?: "success" | "warning" | "danger" | "neutral";
}

export interface KpiAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface KpiDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  tone?: "neutral" | "success" | "warning" | "danger";
  breakdown?: KpiBreakdownItem[];
  actions?: KpiAction[];
}

const toneStyles: Record<NonNullable<KpiDetailModalProps["tone"]>, string> = {
  neutral: "bg-[var(--panel-soft)] text-[var(--brand)]",
  success: "bg-emerald-500/18 text-emerald-100",
  warning: "bg-amber-500/18 text-amber-100",
  danger: "bg-rose-500/18 text-rose-100",
};

function TrendIcon({ trend }: { trend: "up" | "down" | "neutral" }) {
  if (trend === "up") {
    return <TrendingUp className="h-4 w-4 text-green-500" aria-label="Trending up" />;
  }
  if (trend === "down") {
    return <TrendingDown className="h-4 w-4 text-rose-500" aria-label="Trending down" />;
  }
  return null;
}

export function KpiDetailModal({
  open,
  onOpenChange,
  title,
  value,
  description,
  icon: Icon,
  tone = "neutral",
  breakdown,
  actions,
}: KpiDetailModalProps) {
  const { t } = useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[70vh] overflow-y-auto"
        aria-describedby="kpi-detail-description"
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${toneStyles[tone]}`}>
              <Icon className="h-5 w-5" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription id="kpi-detail-description">{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Main Value */}
          <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-5">
            <p className="text-sm text-[var(--ink-soft)]">{t("dashboard.kpi.objectiveCoverage")}</p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {value}
            </p>
          </div>

          {/* Breakdown Items */}
          {breakdown && breakdown.length > 0 && (
            <div className="space-y-3">
              <p className="font-semibold text-[var(--ink)]">{t("dashboard.projectsGrid")}</p>
              <div className="grid gap-3">
                {breakdown.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-[10px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[var(--ink-soft)]">{item.label}</span>
                      {item.trend && <TrendIcon trend={item.trend} />}
                    </div>
                    <Badge variant={item.tone || "neutral"}>{item.value}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {actions && actions.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {actions.map((action, index) => (
                <Button
                  key={index}
                  onClick={() => {
                    action.onClick?.();
                    onOpenChange(false);
                  }}
                  variant={index === 0 ? "default" : "outline"}
                  size="sm"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
