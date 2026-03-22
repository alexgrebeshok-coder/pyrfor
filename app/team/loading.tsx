import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

function TeamSkeleton() {
  return (
    <div className="grid min-w-0 gap-3">
      {/* Stats skeleton */}
      <div className="grid gap-2 grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="p-2">
            <Skeleton className="h-3 w-16 mb-1" />
            <Skeleton className="h-6 w-10" />
          </Card>
        ))}
      </div>

      {/* Team grid skeleton */}
      <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index} className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-24 mb-1" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="h-1.5 w-full mb-2" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function TeamLoading() {
  return <TeamSkeleton />;
}
