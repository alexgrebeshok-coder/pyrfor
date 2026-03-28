import { ChartSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function AnalyticsLoading() {
  return (
    <div className="container mx-auto py-6">
      {/* Header skeleton */}
      <div className="mb-6">
        <Skeleton className="h-7 w-32 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Tabs skeleton */}
      <div className="space-y-4">
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-md" />
          ))}
        </div>

        {/* Content skeleton */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-5 w-32 mb-4" />
              <ChartSkeleton className="h-48" />
            </Card>
          ))}
        </div>

        {/* Large chart skeleton */}
        <Card className="p-4">
          <Skeleton className="h-5 w-40 mb-4" />
          <ChartSkeleton className="h-64" />
        </Card>
      </div>
    </div>
  );
}
