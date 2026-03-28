import { type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DomainHeaderChip {
  label: string;
  variant?: "danger" | "info" | "neutral" | "success" | "warning";
}

export function DomainPageHeader({
  actions,
  chips = [],
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  chips?: DomainHeaderChip[];
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <Card className="app-page-intro-card min-w-0 overflow-hidden border-[var(--line-strong)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-panel)_90%,var(--brand)_10%)_0%,var(--surface-panel)_56%,color-mix(in_srgb,var(--panel-soft)_94%,white_6%)_100%)] shadow-[var(--card-shadow-strong)]">
      <CardHeader className="relative min-w-0 gap-5 border-b border-[var(--line)] md:flex-row md:items-start md:justify-between">
        <div className="relative min-w-0 max-w-3xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            {eyebrow}
          </p>
          <div className="min-w-0 space-y-3">
            <CardTitle className="break-words text-3xl tracking-[-0.06em] sm:text-4xl lg:text-[2.75rem]">
              {title}
            </CardTitle>
            <p className="max-w-2xl break-words text-sm leading-7 text-[var(--ink-soft)] sm:text-[15px]">
              {description}
            </p>
          </div>
        </div>

        {actions ? <div className="relative min-w-0 flex flex-wrap gap-3">{actions}</div> : null}
      </CardHeader>

      {chips.length ? (
        <CardContent className="relative min-w-0 flex flex-wrap gap-2 pt-4">
          {chips.map((chip, index) => (
            <Badge key={`${index}-${chip.label}`} variant={chip.variant ?? "neutral"}>
              {chip.label}
            </Badge>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}
