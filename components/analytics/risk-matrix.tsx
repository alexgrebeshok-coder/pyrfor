"use client";

import React, { useMemo, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RiskData, RiskMatrixCell } from "@/lib/types/analytics";
import { cn } from "@/lib/utils";
import { getRiskLevel, getLevelLabelWithRange } from "@/lib/utils/risk-helpers";

interface RiskMatrixProps {
  data: RiskData[];
  loading?: boolean;
  className?: string;
}

const RISK_COLORS = {
  low: {
    bg: "bg-green-100 dark:bg-green-900/30",
    border: "border-green-300 dark:border-green-700",
    text: "text-green-800 dark:text-green-200",
  },
  medium: {
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    border: "border-yellow-300 dark:border-yellow-700",
    text: "text-yellow-800 dark:text-yellow-200",
  },
  high: {
    bg: "bg-orange-100 dark:bg-orange-900/30",
    border: "border-orange-300 dark:border-orange-700",
    text: "text-orange-800 dark:text-orange-200",
  },
  critical: {
    bg: "bg-red-100 dark:bg-red-900/30",
    border: "border-red-300 dark:border-red-700",
    text: "text-red-800 dark:text-red-200",
  },
};

const LABELS = {
  probability: "Вероятность",
  impact: "Влияние",
  levels: {
    1: "Очень низкая",
    2: "Низкая",
    3: "Средняя",
    4: "Высокая",
    5: "Очень высокая",
  },
};

/**
 * Risk Matrix Component
 * 5×5 grid showing risk distribution by probability and impact
 */
export function RiskMatrix({ data, loading = false, className }: RiskMatrixProps) {
  const [hoveredCell, setHoveredCell] = useState<{ prob: number; impact: number } | null>(null);
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Build 5×5 matrix
  const matrix = useMemo(() => {
    const grid: RiskMatrixCell[][] = [];

    // Initialize 5×5 grid
    for (let prob = 5; prob >= 1; prob--) {
      const row: RiskMatrixCell[] = [];
      for (let impact = 1; impact <= 5; impact++) {
        const severity = prob * impact;
        const level = getRiskLevel(severity);
        const risks = data.filter(
          (r) => r.probability === prob && r.impact === impact
        );

        row.push({
          probability: prob,
          impact,
          risks,
          level,
        });
      }
      grid.push(row);
    }

    return grid;
  }, [data]);

  const totalRisks = data.length;

  // Focus a specific cell
  const focusCell = useCallback((prob: number, impact: number) => {
    const key = `${prob}-${impact}`;
    const cell = cellRefs.current.get(key);
    if (cell) {
      cell.focus();
    }
  }, []);

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent, prob: number, impact: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusCell(prob, Math.min(5, impact + 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusCell(prob, Math.max(1, impact - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusCell(Math.min(5, prob + 1), impact);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusCell(Math.max(1, prob - 1), impact);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setHoveredCell({ prob, impact });
        break;
      case 'Escape':
        setHoveredCell(null);
        break;
    }
  }, [focusCell]);

  // Hover handlers with useCallback
  const handleCellHover = useCallback((prob: number, impact: number) => {
    setHoveredCell({ prob, impact });
  }, []);

  const handleCellLeave = useCallback(() => {
    setHoveredCell(null);
  }, []);

  if (loading) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <CardTitle>Матрица рисков</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full animate-pulse rounded bg-[var(--surface-secondary)]" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <CardTitle>Матрица рисков</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <p className="text-lg font-medium text-[var(--ink)]">Нет рисков для отображения</p>
            <p className="text-sm text-[var(--ink-muted)] mt-2">
              Добавьте риски в проекты, чтобы увидеть их на матрице
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>Матрица рисков</CardTitle>
        <p className="text-sm text-[var(--ink-muted)]">
          Вероятность × Влияние • Всего рисков: {totalRisks}
        </p>
      </CardHeader>
      <CardContent>
        <div 
          className="relative"
          role="grid"
          aria-label="Матрица рисков 5 на 5: вероятность по вертикали, влияние по горизонтали"
        >
          {/* Y-axis label (Probability) */}
          <div className="absolute -left-2 top-1/2 -translate-y-1/2 -rotate-90 text-sm font-medium text-[var(--ink-muted)] whitespace-nowrap">
            {LABELS.probability} →
          </div>

          {/* X-axis label (Impact) */}
          <div className="text-center text-sm font-medium text-[var(--ink-muted)] mb-4">
            {LABELS.impact} →
          </div>

          {/* Grid */}
          <div className="ml-12">
            {/* Impact labels (X-axis) */}
            <div className="flex gap-1 mb-2">
              <div className="w-16" /> {/* Spacer */}
              {[1, 2, 3, 4, 5].map((impact) => (
                <div key={impact} className="w-16 text-center text-xs text-[var(--ink-muted)]">
                  {impact}
                </div>
              ))}
            </div>

            {/* Matrix rows */}
            {matrix.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-1 items-center mb-1">
                {/* Probability label (Y-axis) */}
                <div className="w-16 text-right text-xs text-[var(--ink-muted)] pr-2">
                  {5 - rowIndex}
                </div>

                {/* Cells */}
                {row.map((cell) => {
                  const count = cell.risks.length;
                  const isHovered =
                    hoveredCell?.prob === cell.probability &&
                    hoveredCell?.impact === cell.impact;

                  return (
                    <div
                      key={`${cell.probability}-${cell.impact}`}
                      ref={(el) => {
                        if (el) {
                          cellRefs.current.set(`${cell.probability}-${cell.impact}`, el);
                        }
                      }}
                      className={cn(
                        "w-16 h-16 border-2 rounded flex flex-col items-center justify-center cursor-pointer transition-all",
                        RISK_COLORS[cell.level].bg,
                        RISK_COLORS[cell.level].border,
                        isHovered && "ring-2 ring-blue-500 ring-offset-2"
                      )}
                      onMouseEnter={() => handleCellHover(cell.probability, cell.impact)}
                      onMouseLeave={handleCellLeave}
                      onKeyDown={(e) => handleKeyDown(e, cell.probability, cell.impact)}
                      role="gridcell"
                      aria-label={`${LABELS.probability} ${cell.probability}, ${LABELS.impact} ${cell.impact}, уровень ${cell.level}, рисков: ${count}`}
                      tabIndex={0}
                    >
                      {count > 0 && (
                        <>
                          <span
                            className={cn(
                              "text-2xl font-bold",
                              RISK_COLORS[cell.level].text
                            )}
                          >
                            {count}
                          </span>
                          <span
                            className={cn(
                              "text-xs",
                              RISK_COLORS[cell.level].text
                            )}
                          >
                            {count === 1 ? "риск" : count < 5 ? "риска" : "рисков"}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="mt-6 flex gap-4 justify-center flex-wrap">
            {(["low", "medium", "high", "critical"] as const).map((level) => (
              <div key={level} className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-4 h-4 rounded border-2",
                    RISK_COLORS[level].bg,
                    RISK_COLORS[level].border
                  )}
                />
                <span className="text-sm text-[var(--ink-muted)]">
                  {getLevelLabelWithRange(level)}
                </span>
              </div>
            ))}
          </div>

          {/* Tooltip for hovered cell */}
          {hoveredCell && (
            <div className="mt-4 p-3 bg-[var(--surface-panel)] border border-[var(--line-strong)] rounded text-sm">
              <p className="font-semibold text-[var(--ink)]">
                {LABELS.probability}: {hoveredCell.prob} ({LABELS.levels[hoveredCell.prob as keyof typeof LABELS.levels]})
              </p>
              <p className="font-semibold text-[var(--ink)]">
                {LABELS.impact}: {hoveredCell.impact} ({LABELS.levels[hoveredCell.impact as keyof typeof LABELS.levels]})
              </p>
              <p className="text-[var(--ink-muted)] mt-1">
                Критичность: {hoveredCell.prob * hoveredCell.impact} ({getLevelLabelWithRange(getRiskLevel(hoveredCell.prob * hoveredCell.impact))})
              </p>
            </div>
          )}
        </div>

        <p className="sr-only">
          Матрица рисков показывает распределение {totalRisks} рисков по вероятности и влиянию.
          Зелёный — низкий риск, жёлтый — средний, оранжевый — высокий, красный — критичный.
        </p>
      </CardContent>
    </Card>
  );
}
