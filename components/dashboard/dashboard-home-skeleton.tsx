"use client";

import Link from "next/link";
import { ArrowUpRight, MapPinned, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChartSkeleton, KpiCardSkeleton, ProjectCardSkeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import type { MessageKey } from "@/lib/translations";

function DashboardMapLoading() {
  return (
    <div
      aria-hidden="true"
      className="min-h-[520px] animate-pulse rounded-[22px] border border-[var(--line)] bg-[var(--surface-secondary)]/40"
    />
  );
}

export function DashboardHomeSkeleton({
  t,
}: {
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <KpiCardSkeleton key={index} />
        ))}
      </div>
      <Card className="p-3" data-testid="dashboard-map">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MapPinned className="h-4 w-4 text-[var(--brand)]" />
                  <h3 className="text-xs font-medium">{t("dashboard.map")}</h3>
                </div>
                <p className="text-[10px] text-muted-foreground">{t("dashboard.mapDescription")}</p>
              </div>
              <Badge variant="neutral">…</Badge>
            </div>
            <DashboardMapLoading />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Активные контуры
              </p>
              <span className="text-[10px] text-muted-foreground">
                Подтягиваем рабочие контуры
              </span>
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-28 rounded-full bg-[var(--line)]/70" />
                      <div className="h-3 w-32 rounded-full bg-[var(--line)]/60" />
                    </div>
                    <div className="h-6 w-8 rounded-full bg-[var(--line)]/70" />
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="h-2.5 rounded-full bg-[var(--line)]/70" />
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-3 w-20 rounded-full bg-[var(--line)]/60" />
                      <div className="h-3 w-10 rounded-full bg-[var(--line)]/60" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Link
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "h-8 text-xs",
                })}
                href="/field-operations"
              >
                {t("dashboard.mapOpen")}
                <ArrowUpRight className="ml-auto h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <Card className="p-3">
          <div className="grid gap-2 grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <ProjectCardSkeleton key={index} />
            ))}
          </div>
        </Card>
        <div className="grid gap-3">
          <Card className="p-3" data-testid="dashboard-goals">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-[var(--brand)]" />
                  <h3 className="text-xs font-medium">Цели и фокус</h3>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Темы, которые объединяют проекты и подсказывают управленческий курс.
                </p>
              </div>
              <Badge variant="neutral">…</Badge>
            </div>
            <div className="space-y-1.5">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="rounded-lg border bg-[var(--panel-soft)]/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-3 w-32 rounded-full bg-[var(--line)]/70" />
                    <div className="h-5 w-10 rounded-full bg-[var(--line)]/70" />
                  </div>
                  <div className="mt-2 h-2 w-24 rounded-full bg-[var(--line)]/60" />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">Подтягиваем цели из проектов</p>
              <Link
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "h-8 text-xs",
                })}
                href="/goals"
              >
                Цели
                <ArrowUpRight className="ml-auto h-3 w-3" />
              </Link>
            </div>
          </Card>
          <Card className="p-3">
            <ChartSkeleton className="h-48" />
          </Card>
        </div>
      </div>
    </div>
  );
}
