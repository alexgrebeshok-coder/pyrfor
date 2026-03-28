"use client";

import { Edit2, Plus, Trash2 } from "lucide-react";

import type { ExpenseCategoryView, ExpenseView } from "@/components/expenses/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

interface ExpenseListProps {
  categories: ExpenseCategoryView[];
  expenses: ExpenseView[];
  onCreate: () => void;
  onDelete: (expense: ExpenseView) => void;
  onEdit: (expense: ExpenseView) => void;
  onFilterChange: (filters: { categoryId: string; projectId: string; status: string }) => void;
  projects: Pick<Project, "id" | "name">[];
  selectedFilters: { categoryId: string; projectId: string; status: string };
}

export function ExpenseList({
  categories,
  expenses,
  onCreate,
  onDelete,
  onEdit,
  onFilterChange,
  projects,
  selectedFilters,
}: ExpenseListProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Расходы</CardTitle>
          <div className="text-sm text-[var(--ink-muted)]">
            Список расходов с фильтрами по проекту, категории и статусу.
          </div>
        </div>
        <Button onClick={onCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Новый расход
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--field)] px-3 text-sm text-[var(--ink)]"
            onChange={(event) =>
              onFilterChange({ ...selectedFilters, projectId: event.target.value })
            }
            value={selectedFilters.projectId}
          >
            <option value="">Все проекты</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--field)] px-3 text-sm text-[var(--ink)]"
            onChange={(event) =>
              onFilterChange({ ...selectedFilters, categoryId: event.target.value })
            }
            value={selectedFilters.categoryId}
          >
            <option value="">Все категории</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--field)] px-3 text-sm text-[var(--ink)]"
            onChange={(event) =>
              onFilterChange({ ...selectedFilters, status: event.target.value })
            }
            value={selectedFilters.status}
          >
            <option value="">Все статусы</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="paid">paid</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--line)]">
          <div className="grid grid-cols-[minmax(220px,1.6fr)_140px_130px_120px_120px] bg-[var(--panel-soft)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            <div>Расход</div>
            <div>Категория</div>
            <div>Проект</div>
            <div>Сумма</div>
            <div className="text-right">Действия</div>
          </div>

          {expenses.length === 0 ? (
            <div className="px-4 py-8 text-sm text-[var(--ink-muted)]">
              По выбранным фильтрам расходов нет.
            </div>
          ) : (
            expenses.map((expense) => (
              <div
                key={expense.id}
                className="grid grid-cols-[minmax(220px,1.6fr)_140px_130px_120px_120px] items-center border-t border-[var(--line)] px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--ink)]">{expense.title}</div>
                  <div className="truncate text-xs text-[var(--ink-muted)]">
                    {expense.date.slice(0, 10)} · {expense.status}
                    {expense.description ? ` · ${expense.description}` : ""}
                  </div>
                </div>
                <div className="min-w-0">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-1 text-xs font-medium text-white",
                      expense.category.color ? "" : "bg-slate-500"
                    )}
                    style={{
                      backgroundColor: expense.category.color ?? "#64748b",
                    }}
                  >
                    {expense.category.name}
                  </span>
                </div>
                <div className="truncate text-[var(--ink)]">{expense.project.name}</div>
                <div className="font-semibold text-[var(--ink)]">
                  {formatCurrency(expense.amount, expense.currency)}
                </div>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => onEdit(expense)} size="sm" variant="outline">
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button onClick={() => onDelete(expense)} size="sm" variant="danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
