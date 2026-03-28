"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { MaterialList } from "@/components/materials/material-list";
import { MaterialMovementForm } from "@/components/materials/material-movement-form";
import type { MaterialView } from "@/components/resources/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { useProjects } from "@/lib/hooks/use-api";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load materials");
  return response.json();
};

export default function MaterialsRoute() {
  const { projects } = useProjects();
  const projectOptions = projects.map((project) => ({ id: project.id, name: project.name }));
  const { data, mutate } = useSWR<{ materials: MaterialView[] }>("/api/materials", fetcher);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialView | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    unit: "",
    category: "",
    currentStock: "",
    minStock: "",
    unitPrice: "",
  });

  async function createMaterial() {
    const response = await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        currentStock: form.currentStock ? Number(form.currentStock) : 0,
        minStock: form.minStock ? Number(form.minStock) : 0,
        unitPrice: form.unitPrice ? Number(form.unitPrice) : null,
      }),
    });
    if (!response.ok) {
      toast.error("Не удалось создать материал.");
      return;
    }
    await mutate();
    toast.success("Материал создан.");
    setForm({ name: "", unit: "", category: "", currentStock: "", minStock: "", unitPrice: "" });
  }

  async function createMovement(payload: {
    projectId: string;
    type: string;
    quantity: number;
    unitPrice?: number;
    date: string;
  }) {
    if (!selectedMaterial) return;
    const response = await fetch(`/api/materials/${selectedMaterial.id}/movement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      toast.error("Не удалось записать движение.");
      return;
    }
    await mutate();
    toast.success("Движение записано.");
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Материалы</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Название" value={form.name} />
          <Input onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="Ед. изм." value={form.unit} />
          <Input onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Категория" value={form.category} />
          <Input onChange={(event) => setForm((current) => ({ ...current, currentStock: event.target.value }))} placeholder="Остаток" type="number" value={form.currentStock} />
          <Input onChange={(event) => setForm((current) => ({ ...current, minStock: event.target.value }))} placeholder="Min stock" type="number" value={form.minStock} />
          <Input onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} placeholder="Цена" type="number" value={form.unitPrice} />
          <button className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white" onClick={createMaterial} type="button">
            Создать материал
          </button>
        </CardContent>
      </Card>

      <MaterialList
        materials={data?.materials ?? []}
        onCreateMovement={(material) => {
          setSelectedMaterial(material);
          setMovementOpen(true);
        }}
      />

      <MaterialMovementForm
        material={selectedMaterial}
        onOpenChange={setMovementOpen}
        onSubmit={createMovement}
        open={movementOpen}
        projects={projectOptions}
      />
    </div>
  );
}
