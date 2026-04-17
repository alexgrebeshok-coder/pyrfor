import { Card } from "@/components/ui/card";

export function CalendarViewLoadingState() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-56 animate-pulse rounded bg-[var(--surface-secondary)]" />
          <div className="h-4 w-64 animate-pulse rounded bg-[var(--surface-secondary)]" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-10 animate-pulse rounded-lg bg-[var(--surface-secondary)]" />
          <div className="h-10 w-10 animate-pulse rounded-lg bg-[var(--surface-secondary)]" />
        </div>
      </div>
      <Card className="p-6">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
          {Array.from({ length: 28 }).map((_, index) => (
            <div key={index} className="min-h-[96px] bg-[var(--surface-panel)] p-3">
              <div className="h-4 w-4 animate-pulse rounded bg-[var(--surface-secondary)]" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
