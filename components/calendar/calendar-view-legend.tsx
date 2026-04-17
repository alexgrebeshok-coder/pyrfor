export function CalendarViewLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded" style={{ backgroundColor: "#3b82f6" }} />
        <span>In Progress</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded" style={{ backgroundColor: "#22c55e" }} />
        <span>Done</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded" style={{ backgroundColor: "#f43f5e" }} />
        <span>Blocked</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded" style={{ backgroundColor: "#94a3b8" }} />
        <span>Todo</span>
      </div>
    </div>
  );
}
