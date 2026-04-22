export interface Risk {
  type: 'budget' | 'schedule' | 'resource' | 'external';
  severity: 'low' | 'medium' | 'high' | 'critical';
  probability: number; // 0.1 - 1.0
  impact: number;      // 1 - 5
  urgency: number;     // 1 - 3
  description: string;
  mitigation?: string[];
}

export function calculateRiskScore(probability: number, impact: number, urgency: number): number {
  return probability * impact * urgency;
}

export function getRiskCategory(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score > 10) return 'critical';
  if (score > 6) return 'high';
  if (score > 3) return 'medium';
  return 'low';
}
