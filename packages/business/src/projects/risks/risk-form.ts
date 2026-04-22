import type { RiskStatus } from "@/lib/types";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskFormValues {
  title: string;
  description?: string;
  projectId: string;
  probability: number;
  impact: number;
  status: RiskStatus;
}

export interface RiskApiPayload {
  title: string;
  description?: string;
  projectId: string;
  probability: RiskLevel;
  impact: RiskLevel;
  status: RiskStatus;
}

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score <= 2) return "low";
  if (score <= 4) return "medium";
  return "high";
}

export function buildRiskApiPayload(values: RiskFormValues): RiskApiPayload {
  return {
    title: values.title,
    description: values.description,
    projectId: values.projectId,
    probability: scoreToRiskLevel(values.probability),
    impact: scoreToRiskLevel(values.impact),
    status: values.status,
  };
}
