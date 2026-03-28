"use client";

import { MapPin, Truck } from "lucide-react";

import type { EquipmentView } from "@/components/resources/types";
import { Card, CardContent } from "@/components/ui/card";
import type { Project } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface EquipmentCardProps {
  equipment: EquipmentView;
  onAssign: (equipment: EquipmentView, projectId: string) => Promise<void>;
  projects: Pick<Project, "id" | "name">[];
}

export function EquipmentCard({ equipment, onAssign, projects }: EquipmentCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--ink)]">{equipment.name}</div>
            <div className="text-xs text-[var(--ink-muted)]">
              {equipment.type}
              {equipment.model ? ` · ${equipment.model}` : ""}
              {equipment.serialNumber ? ` · ${equipment.serialNumber}` : ""}
            </div>
          </div>
          <span className="rounded-full bg-[var(--panel-soft)] px-2 py-1 text-xs font-medium text-[var(--ink)]">
            {equipment.status}
          </span>
        </div>

        <div className="grid gap-2 text-sm text-[var(--ink)]">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-[var(--ink-muted)]" />
            <span>{equipment.project?.name ?? "Свободна"}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[var(--ink-muted)]" />
            <span>{equipment.location ?? "Локация не указана"}</span>
          </div>
          <div className="text-xs text-[var(--ink-muted)]">
            {equipment.dailyRate ? `Day ${formatCurrency(equipment.dailyRate)}` : "Day —"}
            {" · "}
            {equipment.hourlyRate ? `Hour ${formatCurrency(equipment.hourlyRate)}` : "Hour —"}
          </div>
        </div>

        <div className="space-y-2">
          <select
            className="h-10 w-full rounded-md border border-[var(--line-strong)] bg-[var(--field)] px-3 text-sm text-[var(--ink)]"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                void onAssign(equipment, event.target.value);
                event.currentTarget.value = "";
              }
            }}
          >
            <option value="">Назначить на проект…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {equipment.assignments[0] ? (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)]/40 px-3 py-2 text-xs text-[var(--ink-muted)]">
              Последнее назначение: {equipment.assignments[0].project.name} ·{" "}
              {equipment.assignments[0].startDate.slice(0, 10)}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
