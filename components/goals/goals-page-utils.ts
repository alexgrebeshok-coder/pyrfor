export function getVariant(count: number, thresholds = { warning: 1, danger: 3 }) {
  if (count === 0) return "success" as const;
  if (count <= thresholds.warning) return "warning" as const;
  if (count <= thresholds.danger) return "danger" as const;
  return "danger" as const;
}

export function getScoreFromCount(count: number, step = 22) {
  if (count <= 0) return 100;
  return Math.max(18, 100 - count * step);
}
