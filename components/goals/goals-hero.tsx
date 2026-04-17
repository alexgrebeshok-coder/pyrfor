import Link from "next/link";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Gauge,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { GoalsHeroProps } from "@/components/goals/goals-page.types";

export function GoalsHero({
  clusters,
  deviationCount,
  overloadedMembersCount,
  projectsCount,
  showLoadingState,
}: GoalsHeroProps) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-[color:var(--line)] bg-[linear-gradient(135deg,rgba(15,23,42,0.96)_0%,rgba(29,78,216,0.95)_55%,rgba(37,99,235,0.95)_100%)] text-white shadow-[0_24px_90px_rgba(15,23,42,.16)]">
      <div className="grid gap-3 p-3 lg:grid-cols-[1.15fr_.85fr] lg:p-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">Управленческий контур</Badge>
            <Badge variant="info">OKR</Badge>
            <Badge variant="success">Живые данные</Badge>
          </div>
          <div className="space-y-3">
            <h1 className="font-heading text-xl font-semibold tracking-[-0.06em] sm:text-2xl">
              Цели и ключевые результаты
            </h1>
            <p className="max-w-xl text-xs leading-5 text-slate-100/84">
              Здесь портфельные цели связываются с проектами, сигналами и следующими
              действиями. Это первая живая версия слоя целей и ключевых результатов
              (OKR), собранная из уже существующих данных.
            </p>
            {showLoadingState ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/10 px-3 py-1.5 text-xs tracking-[0.08em] text-slate-100/88">
                <Skeleton className="h-2.5 w-2.5 rounded-full bg-white/70" />
                Подтягиваем живые данные для целей
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className={buttonVariants({ variant: "default", size: "sm" })} href="/portfolio">
              <BriefcaseBusiness className="h-4 w-4" />
              Открыть портфель
            </Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/projects">
              <ArrowUpRight className="h-4 w-4" />
              Открыть проекты
            </Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/analytics">
              <Gauge className="h-4 w-4" />
              Смотреть аналитику
            </Link>
          </div>
        </div>

        <div className="grid gap-2 rounded-[24px] border border-white/12 bg-white/10 p-3 backdrop-blur">
          <div className="grid gap-2 sm:grid-cols-2">
            {showLoadingState
              ? Array.from({ length: 4 }, (_, index) => (
                  <div className="rounded-[18px] border border-white/12 bg-white/8 p-3" key={index}>
                    <Skeleton className="h-3 w-28 bg-white/70" />
                    <Skeleton className="mt-2 h-9 w-16 bg-white/70" />
                    <Skeleton className="mt-2 h-4 w-full bg-white/70" />
                  </div>
                ))
              : (
                  <>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">
                        Целей в контуре
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">
                        {clusters.length}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">
                        Четыре управленческие оси для ежедневного контроля.
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">
                        Проектов в покрытии
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">
                        {projectsCount}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">
                        Каждый проект связан с целями и сигналами.
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">
                        Перегруженные участники
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">
                        {overloadedMembersCount}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">
                        Слоты ёмкости, которые стоит защитить в ближайшем цикле.
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/12 bg-white/8 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-200/80">
                        Отклонения плана
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.06em]">
                        {deviationCount}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-100/80">
                        Сигналы, которые требуют управленческого решения.
                      </p>
                    </div>
                  </>
                )}
          </div>
        </div>
      </div>
    </section>
  );
}
