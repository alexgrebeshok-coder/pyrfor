/**
 * Loading skeleton components for analytics page
 * Used during lazy loading of heavy components
 */

export function TimelineLoading() {
  return (
    <div className="flex items-center justify-center h-64 bg-[var(--surface-panel)] rounded-lg">
      <div className="animate-pulse text-[var(--ink-muted)]">Загрузка таймлайна...</div>
    </div>
  );
}

export function ChartLoading({ height = "h-[320px]" }: { height?: string }) {
  return (
    <div className={`flex items-center justify-center ${height} bg-[var(--surface-panel)] rounded-lg`}>
      <div className="animate-pulse text-[var(--ink-muted)]">Загрузка графика...</div>
    </div>
  );
}

export function DashboardLoading() {
  return (
    <div className="flex items-center justify-center h-96 bg-[var(--surface-panel)] rounded-lg">
      <div className="animate-pulse text-[var(--ink-muted)]">Загрузка дашборда...</div>
    </div>
  );
}
