"use client";

import type { MaterialView } from "@/components/resources/types";
import { cn, formatCurrency } from "@/lib/utils";

interface MaterialListProps {
  materials: MaterialView[];
  onCreateMovement: (material: MaterialView) => void;
}

export function MaterialList({ materials, onCreateMovement }: MaterialListProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)]">
      <div className="grid grid-cols-[minmax(220px,1.6fr)_110px_110px_120px_120px] bg-[var(--panel-soft)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        <div>Материал</div>
        <div>Остаток</div>
        <div>Min stock</div>
        <div>Цена</div>
        <div className="text-right">Движение</div>
      </div>
      {materials.map((material) => {
        const lowStock = material.currentStock <= material.minStock;
        return (
          <div
            key={material.id}
            className="grid grid-cols-[minmax(220px,1.6fr)_110px_110px_120px_120px] items-center border-t border-[var(--line)] px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-[var(--ink)]">{material.name}</div>
              <div className="truncate text-xs text-[var(--ink-muted)]">
                {material.category} · {material.supplier?.name ?? "Без поставщика"}
              </div>
            </div>
            <div className={cn("font-semibold", lowStock ? "text-rose-600" : "text-[var(--ink)]")}>
              {material.currentStock} {material.unit}
            </div>
            <div className="text-[var(--ink)]">
              {material.minStock} {material.unit}
            </div>
            <div className="text-[var(--ink)]">
              {material.unitPrice ? formatCurrency(material.unitPrice) : "—"}
            </div>
            <div className="text-right">
              <button
                className="rounded-md border border-[var(--line-strong)] px-3 py-2 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--panel-soft)]"
                onClick={() => onCreateMovement(material)}
                type="button"
              >
                Записать
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
