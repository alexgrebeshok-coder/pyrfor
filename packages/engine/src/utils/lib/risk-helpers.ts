/**
 * Risk level utilities shared across analytics components
 */

export const RISK_LEVELS = {
  low: { threshold: 4, label: 'Низкий', color: '#22c55e' },
  medium: { threshold: 9, label: 'Средний', color: '#eab308' },
  high: { threshold: 16, label: 'Высокий', color: '#f97316' },
  critical: { threshold: 25, label: 'Критичный', color: '#ef4444' },
} as const;

export type RiskLevel = keyof typeof RISK_LEVELS;

/**
 * Determine risk level based on severity score (probability × impact)
 */
export function getRiskLevel(severity: number): RiskLevel {
  if (severity <= 4) return 'low';
  if (severity <= 9) return 'medium';
  if (severity <= 16) return 'high';
  return 'critical';
}

/**
 * Get human-readable label for a risk level
 */
export function getLevelLabel(level: RiskLevel): string {
  return RISK_LEVELS[level].label;
}

/**
 * Get color hex code for a risk level
 */
export function getLevelColor(level: RiskLevel): string {
  return RISK_LEVELS[level].color;
}

/**
 * Get detailed label with threshold range
 */
export function getLevelLabelWithRange(level: RiskLevel): string {
  const labels = {
    low: "Низкий (1-4)",
    medium: "Средний (5-9)",
    high: "Высокий (10-16)",
    critical: "Критичный (17-25)",
  };
  return labels[level];
}
