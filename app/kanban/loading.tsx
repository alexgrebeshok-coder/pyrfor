import { KanbanColumnSkeleton } from "@/components/ui/skeleton";

export default function KanbanLoading() {
  return (
    <div className="grid gap-4 md:grid-cols-3 h-[calc(100vh-200px)]">
      {Array.from({ length: 3 }).map((_, index) => (
        <KanbanColumnSkeleton key={index} />
      ))}
    </div>
  );
}
