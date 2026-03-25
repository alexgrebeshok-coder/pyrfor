"use client";

import type { EquipmentView } from "@/components/resources/types";
import { EquipmentCard } from "@/components/equipment/equipment-card";
import type { Project } from "@/lib/types";

interface EquipmentListProps {
  equipment: EquipmentView[];
  onAssign: (equipment: EquipmentView, projectId: string) => Promise<void>;
  projects: Pick<Project, "id" | "name">[];
}

export function EquipmentList({ equipment, onAssign, projects }: EquipmentListProps) {
  if (equipment.length === 0) {
    return <div className="text-sm text-[var(--ink-muted)]">Техника пока не заведена.</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {equipment.map((item) => (
        <EquipmentCard
          equipment={item}
          key={item.id}
          onAssign={onAssign}
          projects={projects}
        />
      ))}
    </div>
  );
}
