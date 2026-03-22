"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { api } from "@/lib/client/api-error";
import type { RiskData } from "@/lib/types/analytics";
import { getRiskLevel } from "@/lib/utils/risk-helpers";

interface RiskAPIResponse {
  id: string;
  projectId: string;
  project: {
    id: string;
    name: string;
  };
  title: string;
  probability: string; // "low" | "medium" | "high" from API
  impact: string; // "low" | "medium" | "high" from API
  severity: number;
  status: string; // "open" | "mitigated" | "closed"
  owner?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook to fetch and transform risk data for analytics
 * Fetches from /api/risks and calculates severity/level metrics
 */
export function useRiskData(projectId?: string) {
  const { data, error, isLoading, mutate } = useSWR<{ risks: RiskAPIResponse[] }>(
    projectId ? `/api/risks?projectId=${projectId}` : "/api/risks",
    (url) => api.get<{ risks: RiskAPIResponse[] }>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const riskData = useMemo(() => {
    if (!data?.risks) return [];

    return data.risks.map((risk) => {
      // Map string probability/impact to numeric 1-5
      const probability = mapSeverityToNumber(risk.probability);
      const impact = mapSeverityToNumber(risk.impact);
      const severity = probability * impact;
      const level = getRiskLevel(severity);

      return {
        id: risk.id,
        projectId: risk.projectId,
        projectName: risk.project.name,
        title: risk.title,
        probability,
        impact,
        severity,
        level,
        status: risk.status === "mitigated" ? "mitigating" : risk.status as 'open' | 'mitigating' | 'closed',
        category: getCategoryFromTitle(risk.title), // Infer category from title
        createdAt: risk.createdAt,
        updatedAt: risk.updatedAt,
      } as RiskData;
    });
  }, [data]);

  return {
    data: riskData,
    isLoading,
    error,
    refresh: mutate,
  };
}

/**
 * Map string severity to numeric 1-5
 */
function mapSeverityToNumber(severity: string): number {
  const map: Record<string, number> = {
    low: 1,
    medium: 3,
    high: 5,
  };
  return map[severity] ?? 3;
}

/**
 * Infer category from risk title
 * In production, this should come from the database
 */
function getCategoryFromTitle(title: string): string {
  const lowerTitle = title.toLowerCase();
  
  if (lowerTitle.includes('технич') || lowerTitle.includes('оборудован') || lowerTitle.includes('систем')) {
    return 'Технические';
  }
  if (lowerTitle.includes('финанс') || lowerTitle.includes('бюджет') || lowerTitle.includes('стоимост')) {
    return 'Финансовые';
  }
  if (lowerTitle.includes('кадр') || lowerTitle.includes('персонал') || lowerTitle.includes('команд')) {
    return 'Кадровые';
  }
  if (lowerTitle.includes('срок') || lowerTitle.includes('поставк') || lowerTitle.includes('договор')) {
    return 'Организационные';
  }
  if (lowerTitle.includes('прав') || lowerTitle.includes('документ') || lowerTitle.includes('лицензи')) {
    return 'Правовые';
  }
  
  return 'Прочие';
}
