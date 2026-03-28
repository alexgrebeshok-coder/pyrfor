"use client";

import { useEffect, useMemo, useState } from "react";
import { PlusCircle } from "lucide-react";

import type { ExpenseCategoryView, ExpenseView } from "@/components/expenses/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea, fieldStyles } from "@/components/ui/field";
import type { Project } from "@/lib/types";

interface ExpenseFormProps {
  categories: ExpenseCategoryView[];
  expense?: ExpenseView | null;
  onSubmit: (payload: {
    projectId: string;
    categoryId: string;
    title: string;
    description?: string | null;
    amount: number;
    currency: string;
    date: string;
    status: string;
  }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projects: Pick<Project, "id" | "name">[];
}

export function ExpenseForm({
  categories,
  expense,
  onSubmit,
  onOpenChange,
  open,
  projects,
}: ExpenseFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => ({
    projectId: expense?.projectId ?? projects[0]?.id ?? "",
    categoryId: expense?.categoryId ?? categories[0]?.id ?? "",
    title: expense?.title ?? "",
    description: expense?.description ?? "",
    amount: expense?.amount ? String(expense.amount) : "",
    currency: expense?.currency ?? "RUB",
    date: expense?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    status: expense?.status ?? "pending",
  }));

  useEffect(() => {
    setForm({
      projectId: expense?.projectId ?? projects[0]?.id ?? "",
      categoryId: expense?.categoryId ?? categories[0]?.id ?? "",
      title: expense?.title ?? "",
      description: expense?.description ?? "",
      amount: expense?.amount ? String(expense.amount) : "",
      currency: expense?.currency ?? "RUB",
      date: expense?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      status: expense?.status ?? "pending",
    });
  }, [categories, expense, projects]);

  const canSubmit = useMemo(
    () =>
      Boolean(form.projectId && form.categoryId && form.title.trim() && form.amount && form.date),
    [form]
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-[var(--brand)]" />
            {expense ? "Редактировать расход" : "Новый расход"}
          </DialogTitle>
          <DialogDescription>
            Запиши расход по проекту, категории и дате, чтобы он попал в финансовый cockpit.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
            Проект
            <select
              className={`${fieldStyles} h-11 px-3 py-2`}
              onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
              value={form.projectId}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
            Категория
            <select
              className={`${fieldStyles} h-11 px-3 py-2`}
              onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
              value={form.categoryId}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-[var(--ink-soft)] md:col-span-2">
            Название
            <Input
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              value={form.title}
            />
          </label>

          <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
            Сумма
            <Input
              min="0"
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              step="0.01"
              type="number"
              value={form.amount}
            />
          </label>

          <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
            Дата
            <Input
              onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              type="date"
              value={form.date}
            />
          </label>

          <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
            Валюта
            <Input
              onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
              value={form.currency}
            />
          </label>

          <label className="grid gap-1 text-sm text-[var(--ink-soft)]">
            Статус
            <select
              className={`${fieldStyles} h-11 px-3 py-2`}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              value={form.status}
            >
              <option value="pending">pending</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="paid">paid</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm text-[var(--ink-soft)] md:col-span-2">
            Комментарий
            <Textarea
              className="min-h-[120px]"
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              value={form.description}
            />
          </label>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            Отмена
          </Button>
          <Button
            disabled={!canSubmit || submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onSubmit({
                  projectId: form.projectId,
                  categoryId: form.categoryId,
                  title: form.title.trim(),
                  description: form.description.trim() || null,
                  amount: Number(form.amount),
                  currency: form.currency.trim() || "RUB",
                  date: `${form.date}T00:00:00.000Z`,
                  status: form.status,
                });
                onOpenChange(false);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Сохраняю..." : expense ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
