"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { api } from "@/lib/client/api-error";
import type { ApiTeamMember } from "@/lib/client/normalizers";

const fetchTeam = (url: string) => api.get<{ team: ApiTeamMember[] }>(url);

export interface TeamCapacityRow {
  memberName: string;
  allocated: number;
  capacity: number;
  projectsCount: number;
  status: "🟢" | "🟡" | "🟠" | "🔴";
}

export interface TeamCapacityTotals {
  allocated: number;
  capacity: number;
  available: number;
  overloaded: number;
}

export function useTeamCapacity() {
  const { data, error, isLoading, mutate } = useSWR<{ team: ApiTeamMember[] }>("/api/team", fetchTeam, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });

  const team = useMemo(() => data?.team ?? [], [data?.team]);

  const totals = useMemo<TeamCapacityTotals>(() => {
    const totalCapacity = team.reduce((sum, member) => sum + (member.capacity ?? 0), 0);
    const totalAllocated = team.reduce((sum, member) => sum + (member.capacityUsed ?? 0), 0);
    const overloaded = Math.max(0, totalAllocated - totalCapacity);
    const available = Math.max(totalCapacity - totalAllocated, 0);
    const allocated = Math.min(totalAllocated, totalCapacity);

    return {
      allocated,
      capacity: totalCapacity,
      available,
      overloaded,
    };
  }, [team]);

  const rows = useMemo<TeamCapacityRow[]>(() => {
    return team.map((member) => {
      const capacity = member.capacity ?? 0;
      const allocatedValue = member.capacityUsed ?? 0;
      const utilization = capacity > 0 ? Math.round((allocatedValue / capacity) * 100) : 0;
      let status: TeamCapacityRow["status"] = "🟢";

      if (allocatedValue > capacity || utilization >= 100) {
        status = "🔴";
      } else if (utilization >= 85) {
        status = "🟠";
      } else if (utilization >= 65) {
        status = "🟡";
      }

      const projectsCount = Array.isArray(member.projects) ? member.projects.length : 0;

      return {
        memberName: member.name,
        allocated: Math.round(allocatedValue),
        capacity: Math.round(capacity),
        projectsCount,
        status,
      };
    });
  }, [team]);

  return {
    team,
    rows,
    totals,
    error,
    isLoading,
    refresh: mutate,
  };
}
