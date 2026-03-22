export default function FieldOperationsLoading() {
  return (
    <div className="grid gap-4">
      <div className="rounded-[28px] border border-[var(--line)] bg-[var(--surface-panel)] p-6">
        <div className="h-4 w-40 animate-pulse rounded-full bg-[var(--panel-soft)]" />
        <div className="mt-4 h-10 w-72 animate-pulse rounded-2xl bg-[var(--panel-soft)]" />
        <div className="mt-4 h-4 w-full max-w-2xl animate-pulse rounded-full bg-[var(--panel-soft)]" />
      </div>
      <div className="grid gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="h-28 animate-pulse rounded-[24px] border border-[var(--line)] bg-[var(--surface-panel)]"
            key={index}
          />
        ))}
      </div>
      <div className="h-[540px] animate-pulse rounded-[28px] border border-[var(--line)] bg-[var(--surface-panel)]" />
    </div>
  );
}
