import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function DomainMetricCard({
  detail,
  label,
  status,
  value,
}: {
  detail: string;
  label: string;
  status?: {
    label: string;
    variant?: "danger" | "info" | "neutral" | "success" | "warning";
  };
  value: string;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--ink-soft)]">{label}</p>
            <p className="mt-2 font-heading text-xl md:text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {value}
            </p>
          </div>
          {status ? <Badge variant={status.variant ?? "neutral"}>{status.label}</Badge> : null}
        </div>
        <p className="text-sm leading-6 text-[var(--ink-muted)]">{detail}</p>
      </CardContent>
    </Card>
  );
}
