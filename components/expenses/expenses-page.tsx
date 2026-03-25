"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpenseSummary } from "@/components/expenses/expense-summary";
import type { ExpenseCategoryView, ExpensesResponse, ExpenseView } from "@/components/expenses/types";
import { DataErrorState } from "@/components/ui/data-error-state";
import { useProjects } from "@/lib/hooks/use-api";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load expense data");
  }
  return response.json();
};

function buildQuery(filters: Record<string, string>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function ExpensesPage() {
  const { projects } = useProjects();
  const [filters, setFilters] = useState({
    projectId: "",
    categoryId: "",
    status: "",
  });
  const [open, setOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseView | null>(null);

  const expensesKey = `/api/expenses${buildQuery(filters)}`;
  const { data, error, isLoading, mutate } = useSWR<ExpensesResponse>(expensesKey, fetcher);
  const { data: categoriesResponse, mutate: mutateCategories } = useSWR<{ categories: ExpenseCategoryView[] }>(
    "/api/expenses/categories",
    fetcher
  );

  const categories = categoriesResponse?.categories ?? [];
  const expenses = data?.expenses ?? [];
  const summary = data?.summary ?? { total: 0, approved: 0, pending: 0, byCategory: [] };

  const sortedProjects = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects]
  );

  async function handleSubmit(payload: {
    projectId: string;
    categoryId: string;
    title: string;
    description?: string | null;
    amount: number;
    currency: string;
    date: string;
    status: string;
  }) {
    const endpoint = editingExpense ? `/api/expenses/${editingExpense.id}` : "/api/expenses";
    const method = editingExpense ? "PATCH" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("Не удалось сохранить расход.");
    }

    await mutate();
    await mutateCategories();
    toast.success(editingExpense ? "Расход обновлён." : "Расход создан.");
    setEditingExpense(null);
  }

  async function handleDelete(expense: ExpenseView) {
    if (!confirm(`Удалить расход «${expense.title}»?`)) {
      return;
    }

    const response = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Не удалось удалить расход.");
      return;
    }

    await mutate();
    toast.success("Расход удалён.");
  }

  if (error && !data) {
    return (
      <DataErrorState
        actionLabel="Повторить"
        description={error instanceof Error ? error.message : "Ошибка загрузки расходов"}
        onRetry={() => {
          void mutate();
        }}
        title="Не удалось загрузить расходы"
      />
    );
  }

  return (
    <div className="grid gap-4" data-testid="expenses-page">
      <ExpenseSummary summary={summary} />

      <ExpenseList
        categories={categories}
        expenses={expenses}
        onCreate={() => {
          setEditingExpense(null);
          setOpen(true);
        }}
        onDelete={handleDelete}
        onEdit={(expense) => {
          setEditingExpense(expense);
          setOpen(true);
        }}
        onFilterChange={setFilters}
        projects={sortedProjects}
        selectedFilters={filters}
      />

      <ExpenseForm
        categories={categories}
        expense={editingExpense}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setEditingExpense(null);
          }
        }}
        onSubmit={handleSubmit}
        open={open}
        projects={sortedProjects}
      />

      {isLoading ? (
        <div className="text-sm text-[var(--ink-muted)]">Загрузка расходов...</div>
      ) : null}
    </div>
  );
}
