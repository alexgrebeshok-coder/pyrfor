import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import type { GoalCluster } from "@/components/goals/goals-page.types";

export function ClusterCard({ cluster }: { cluster: GoalCluster }) {
  const Icon = cluster.icon;

  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96 shadow-[0_10px_28px_rgba(15,23,42,.05)]">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[var(--panel-soft)] p-3 text-[var(--brand)]">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                Целевой контур
              </p>
              <CardTitle className="mt-1 text-base tracking-[-0.04em]">
                {cluster.title}
              </CardTitle>
              <CardDescription className="mt-1 text-xs leading-5">
                {cluster.description}
              </CardDescription>
            </div>
          </div>
          <Badge variant={cluster.variant}>{cluster.metricLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
            <span>Оценка готовности</span>
            <span>{cluster.score}%</span>
          </div>
          <Progress className="h-2" value={cluster.score} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Текущий результат
            </p>
            <p className="mt-1 text-xs font-semibold tracking-[-0.03em] text-[var(--ink)]">
              {cluster.currentLabel}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Целевой уровень
            </p>
            <p className="mt-1 text-xs font-semibold tracking-[-0.03em] text-[var(--ink)]">
              {cluster.targetLabel}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Следующее действие
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink)]">
            {cluster.nextAction}
          </p>
        </div>
        <ul className="space-y-1.5 text-xs leading-5 text-[var(--ink-soft)]">
          {cluster.highlights.map((line) => (
            <li className="flex gap-3" key={line}>
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
