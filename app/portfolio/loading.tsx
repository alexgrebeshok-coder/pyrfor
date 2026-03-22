import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid gap-3">
      <Card className="p-5">
        <CardContent className="p-0">
          <div className="grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
            <div className="space-y-3">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-9 w-80" />
              <Skeleton className="h-4 w-full max-w-2xl" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-28" />
                <Skeleton className="h-9 w-32" />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-2xl" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <Skeleton className="h-[420px] rounded-3xl" />
        <div className="space-y-3">
          <Skeleton className="h-[420px] rounded-3xl" />
          <ChartSkeleton className="h-[240px]" />
        </div>
      </div>
    </div>
  );
}

