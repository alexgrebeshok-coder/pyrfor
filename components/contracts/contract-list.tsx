"use client";

import type { ContractView } from "@/components/resources/types";
import { formatCurrency, safePercent } from "@/lib/utils";

export function ContractList({ contracts }: { contracts: ContractView[] }) {
  return (
    <div className="grid gap-3">
      {contracts.map((contract) => {
        const progress = safePercent(contract.paidAmount, contract.amount);
        return (
          <div
            key={contract.id}
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-panel)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--ink)]">
                  {contract.number} · {contract.title}
                </div>
                <div className="text-xs text-[var(--ink-muted)]">
                  {contract.project.name} · {contract.supplier.name} · {contract.type}
                </div>
              </div>
              <span className="rounded-full bg-[var(--panel-soft)] px-2 py-1 text-xs font-medium text-[var(--ink)]">
                {contract.status}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-soft)]">
              <div
                className="h-full rounded-full bg-[var(--brand)]"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--ink)]">
              <span>{formatCurrency(contract.paidAmount, contract.currency)} оплачено</span>
              <span>{formatCurrency(contract.amount, contract.currency)} всего</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
