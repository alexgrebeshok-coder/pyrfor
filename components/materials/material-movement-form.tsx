"use client";

import { useEffect, useState } from "react";

import type { MaterialView } from "@/components/resources/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, fieldStyles } from "@/components/ui/field";
import type { Project } from "@/lib/types";

interface MaterialMovementFormProps {
  material: MaterialView | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    projectId: string;
    type: string;
    quantity: number;
    unitPrice?: number;
    date: string;
  }) => Promise<void>;
  open: boolean;
  projects: Pick<Project, "id" | "name">[];
}

export function MaterialMovementForm({
  material,
  onOpenChange,
  onSubmit,
  open,
  projects,
}: MaterialMovementFormProps) {
  const [form, setForm] = useState({
    projectId: projects[0]?.id ?? "",
    type: "receipt",
    quantity: "",
    unitPrice: "",
    date: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    setForm({
      projectId: projects[0]?.id ?? "",
      type: "receipt",
      quantity: "",
      unitPrice: material?.unitPrice ? String(material.unitPrice) : "",
      date: new Date().toISOString().slice(0, 10),
    });
  }, [material, projects]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Движение материала</DialogTitle>
          <DialogDescription>
            {material ? `Материал: ${material.name}` : "Выберите материал"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
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
          <select
            className={`${fieldStyles} h-11 px-3 py-2`}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            value={form.type}
          >
            <option value="receipt">receipt</option>
            <option value="consumption">consumption</option>
            <option value="return">return</option>
            <option value="writeoff">writeoff</option>
          </select>
          <Input
            min="0"
            onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
            placeholder="Количество"
            step="0.01"
            type="number"
            value={form.quantity}
          />
          <Input
            min="0"
            onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))}
            placeholder="Цена за единицу"
            step="0.01"
            type="number"
            value={form.unitPrice}
          />
          <Input
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
            type="date"
            value={form.date}
          />
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Отмена
          </Button>
          <Button
            disabled={!material || !form.projectId || !form.quantity}
            onClick={async () => {
              await onSubmit({
                projectId: form.projectId,
                type: form.type,
                quantity: Number(form.quantity),
                unitPrice: form.unitPrice ? Number(form.unitPrice) : undefined,
                date: `${form.date}T00:00:00.000Z`,
              });
              onOpenChange(false);
            }}
          >
            Сохранить движение
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
