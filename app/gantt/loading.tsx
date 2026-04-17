import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid min-w-0 gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
