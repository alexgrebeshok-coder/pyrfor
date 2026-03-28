import { describe, expect, it } from "vitest";

import { calculateEVM, calculateTaskEVM } from "@/lib/evm/calculator";

describe("calculateEVM", () => {
  it("calculates tcpi metrics for a project", () => {
    const result = calculateEVM(
      {
        id: "project-1",
        name: "Factory upgrade",
        budgetPlan: 1_000_000,
        budgetFact: 600_000,
        progress: 45,
        start: new Date("2026-01-01T00:00:00.000Z"),
        end: new Date("2026-03-01T00:00:00.000Z"),
      },
      new Date("2026-02-01T00:00:00.000Z")
    );

    expect(result.BAC).toBe(1_000_000);
    expect(result.EV).toBe(450_000);
    expect(result.AC).toBe(600_000);
    expect(result.TCPI).toBeCloseTo(1.375, 3);
    expect(result.TCPI_EAC).toBeCloseTo(0.75, 3);
  });
});

describe("calculateTaskEVM", () => {
  it("derives task-level planned and earned values", () => {
    const result = calculateTaskEVM(
      {
        id: "task-1",
        title: "Concrete pour",
        estimatedCost: 100_000,
        actualCost: 60_000,
        percentComplete: 50,
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        dueDate: new Date("2026-03-11T00:00:00.000Z"),
      },
      new Date("2026-03-06T00:00:00.000Z")
    );

    expect(result.BAC).toBe(100_000);
    expect(result.PV).toBe(50_000);
    expect(result.EV).toBe(50_000);
    expect(result.AC).toBe(60_000);
    expect(result.CPI).toBeCloseTo(0.83, 2);
    expect(result.SPI).toBe(1);
    expect(result.plannedPercent).toBe(50);
  });
});
