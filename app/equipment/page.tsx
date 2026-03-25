"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { EquipmentList } from "@/components/equipment/equipment-list";
import type { EquipmentView } from "@/components/resources/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { useProjects } from "@/lib/hooks/use-api";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load equipment");
  return response.json();
};

export default function EquipmentRoute() {
  const { projects } = useProjects();
  const projectOptions = projects.map((project) => ({ id: project.id, name: project.name }));
  const { data, mutate } = useSWR<{ equipment: EquipmentView[] }>("/api/equipment", fetcher);
  const [form, setForm] = useState({
    name: "",
    type: "",
    status: "available",
    projectId: "",
    dailyRate: "",
    hourlyRate: "",
    location: "",
  });

  async function createEquipment() {
    const response = await fetch("/api/equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        projectId: form.projectId || null,
        dailyRate: form.dailyRate ? Number(form.dailyRate) : null,
        hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
        location: form.location || null,
      }),
    });
    if (!response.ok) {
      toast.error("Не удалось создать единицу техники.");
      return;
    }
    await mutate();
    toast.success("Техника создана.");
    setForm({ name: "", type: "", status: "available", projectId: "", dailyRate: "", hourlyRate: "", location: "" });
  }

  async function assignEquipment(equipment: EquipmentView, projectId: string) {
    const response = await fetch(`/api/equipment/${equipment.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        startDate: new Date().toISOString(),
        hoursUsed: 0,
      }),
    });
    if (!response.ok) {
      toast.error("Не удалось назначить технику.");
      return;
    }
    await mutate();
    toast.success("Техника назначена на проект.");
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Техника</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Название"
            value={form.name}
          />
          <Input
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            placeholder="Тип"
            value={form.type}
          />
          <Input
            onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
            placeholder="Локация"
            value={form.location}
          />
          <Input
            onChange={(event) => setForm((current) => ({ ...current, dailyRate: event.target.value }))}
            placeholder="Ставка в день"
            type="number"
            value={form.dailyRate}
          />
          <Input
            onChange={(event) => setForm((current) => ({ ...current, hourlyRate: event.target.value }))}
            placeholder="Ставка в час"
            type="number"
            value={form.hourlyRate}
          />
          <button
            className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white"
            onClick={createEquipment}
            type="button"
          >
            Создать технику
          </button>
        </CardContent>
      </Card>

      <EquipmentList equipment={data?.equipment ?? []} onAssign={assignEquipment} projects={projectOptions} />
    </div>
  );
}
