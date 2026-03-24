import { ChartSkeleton, ProjectCardSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function ProjectsLoading() {
  return (
    <div className="grid min-w-0 gap-4">
      {/* Header skeleton */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Stats row skeleton */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-2">
            <Skeleton className="h-3 w-20 mb-1" />
            <Skeleton className="h-5 w-24" />
          </Card>
        ))}
      </div>

      {/* Projects grid + sidebar skeleton */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Projects grid */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>

        {/* Sidebar with chart */}
        <Card className="h-fit bg-[var(--surface-panel)] p-4">
          <Skeleton className="h-5 w-32 mb-3" />
          <ChartSkeleton className="h-[180px] mb-3" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-6 w-12 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
