import {
  AIContextActionsSkeleton,
  KpiCardSkeleton,
  TaskTableSkeleton,
} from "@/components/ui/skeleton";

export default function TasksLoading() {
  return (
    <div className="grid min-w-0 gap-3">
      {/* AI Context Actions skeleton */}
      <AIContextActionsSkeleton />

      {/* KPI Row skeleton */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <KpiCardSkeleton key={index} />
        ))}
      </div>

      {/* Task table skeleton */}
      <TaskTableSkeleton />
    </div>
  );
}
