import { CalendarDays } from "lucide-react";

import { Card } from "@/components/ui/card";

export function CalendarViewEmptyState() {
  return (
    <Card className="border-dashed p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--panel-soft)] text-[var(--ink-muted)]">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-[var(--ink)]">No calendar events yet</h3>
          <p className="max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
            There are no tasks with due dates in the current dataset, so the calendar is empty for
            this month.
          </p>
        </div>
      </div>
    </Card>
  );
}
