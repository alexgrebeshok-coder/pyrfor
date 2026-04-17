import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/briefs/locale";

type PricingPlan = {
  name: string;
  price: string;
  description: string;
  features: readonly string[];
  highlighted?: boolean;
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    description: "1 project, 1 user, 20 AI/day, basic dashboard.",
    features: ["1 project", "1 user", "20 AI/day"],
  },
  {
    name: "Starter",
    price: "$19",
    description: "5 projects, 3 users, 100 AI/day, Telegram briefs.",
    features: ["5 projects", "3 users", "Telegram", "100 AI/day"],
    highlighted: true,
  },
  {
    name: "Business",
    price: "$49",
    description: "20 projects, 10 users, unlimited AI, analytics + EVM.",
    features: ["20 projects", "10 users", "Analytics", "EVM"],
  },
  {
    name: "Team",
    price: "$99",
    description: "Unlimited, API, custom agents, team performance.",
    features: ["Unlimited", "API", "Custom agents", "Team performance"],
  },
];

function normalizeProjectStatus(status: string): string {
  return status.replace(/_/g, "-");
}

function getToneClass(
  health: number
): { badge: "success" | "warning" | "danger" | "neutral"; color: string } {
  if (health >= 80) {
    return { badge: "success", color: "bg-emerald-500/18 text-emerald-100" };
  }

  if (health >= 60) {
    return { badge: "warning", color: "bg-amber-500/18 text-amber-100" };
  }

  return { badge: "danger", color: "bg-rose-500/18 text-rose-100" };
}

export function formatMetric(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return value.toFixed(2);
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
        {value}
      </p>
    </div>
  );
}

export function DemoProjectCard({
  project,
}: {
  project: {
    name: string;
    status: string;
    progress: number;
    health: number;
    budget: { planned: number; actual: number; currency: string };
    dates: { start: string; end: string };
    nextMilestone: { name: string; date: string } | null;
    location?: string | null;
  };
}) {
  const tone = getToneClass(project.health);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Badge variant={tone.badge}>{normalizeProjectStatus(project.status)}</Badge>
          <h3 className="text-base font-semibold tracking-[-0.03em] text-[var(--ink)]">
            {project.name}
          </h3>
          <p className="text-sm text-[var(--ink-soft)]">
            {project.location ?? "Без локации"}
          </p>
        </div>
        <div className={cn("rounded-xl px-2.5 py-1.5 text-sm font-semibold", tone.color)}>
          {project.health}/100
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
          <span>Progress</span>
          <span>{project.progress}%</span>
        </div>
        <Progress value={project.progress} className="h-2" />
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-[var(--ink-soft)]">
        <span>{formatCurrency(project.budget.actual, project.budget.currency, "ru")}</span>
        <span>
          → {formatCurrency(project.budget.planned, project.budget.currency, "ru")}
        </span>
      </div>

      {project.nextMilestone ? (
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Следующий milestone:{" "}
          <span className="font-medium text-[var(--ink)]">
            {project.nextMilestone.name}
          </span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Milestone пока не назначен.
        </p>
      )}
    </div>
  );
}

export function PricingCard({
  description,
  features,
  highlighted,
  name,
  price,
}: PricingPlan) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        highlighted
          ? "border-[var(--brand)] bg-[var(--brand)]/6"
          : "border-[var(--line)] bg-[var(--panel-soft)]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink)]">{name}</h3>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
            {price}
          </p>
        </div>
        {highlighted ? <Badge variant="info">Recommended</Badge> : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
      <ul className="mt-3 space-y-1 text-sm text-[var(--ink-soft)]">
        {features.map((feature) => (
          <li className="flex items-center gap-2" key={feature}>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
