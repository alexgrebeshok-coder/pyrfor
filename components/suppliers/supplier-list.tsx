"use client";

import type { SupplierView } from "@/components/resources/types";

export function SupplierList({ suppliers }: { suppliers: SupplierView[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)]">
      <div className="grid grid-cols-[minmax(200px,1.4fr)_120px_160px_120px] bg-[var(--panel-soft)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        <div>Поставщик</div>
        <div>ИНН</div>
        <div>Контакт</div>
        <div>Связи</div>
      </div>
      {suppliers.map((supplier) => (
        <div
          key={supplier.id}
          className="grid grid-cols-[minmax(200px,1.4fr)_120px_160px_120px] items-center border-t border-[var(--line)] px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--ink)]">{supplier.name}</div>
            <div className="truncate text-xs text-[var(--ink-muted)]">
              {supplier.category ?? "Без категории"} · rating {supplier.rating ?? 0}
            </div>
          </div>
          <div className="text-[var(--ink)]">{supplier.inn ?? "—"}</div>
          <div className="text-[var(--ink)]">
            {supplier.contactName ?? "—"}
            {supplier.phone ? ` · ${supplier.phone}` : ""}
          </div>
          <div className="text-xs text-[var(--ink-muted)]">
            C {supplier._count?.contracts ?? 0} · M {supplier._count?.materials ?? 0} · E{" "}
            {supplier._count?.expenses ?? 0}
          </div>
        </div>
      ))}
    </div>
  );
}
