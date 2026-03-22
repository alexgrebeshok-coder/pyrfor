import { describe, expect, it } from "vitest";

import {
  summarizePortfolioCapacityOutlook,
  summarizePortfolioFinanceOutlook,
  summarizePortfolioScenarioOutlook,
} from "@/lib/portfolio/portfolio-outlook";

describe("portfolio outlook", () => {
  it("summarizes finance forecast from plan, fact, and CPI", () => {
    const summary = summarizePortfolioFinanceOutlook({
      plannedBudget: 100_000_000,
      actualSpend: 72_000_000,
      portfolioCpi: 0.88,
    });

    expect(summary.plannedBudget).toBe(100_000_000);
    expect(summary.actualSpend).toBe(72_000_000);
    expect(summary.forecastAtCompletion).toBe(113_636_364);
    expect(summary.forecastVariance).toBe(13_636_364);
    expect(summary.currentUsagePercent).toBe(72);
    expect(summary.forecastUsagePercent).toBe(114);
    expect(summary.remainingBudget).toBe(28_000_000);
    expect(summary.tone).toBe("danger");
  });

  it("summarizes capacity pressure from totals and overloaded members", () => {
    const summary = summarizePortfolioCapacityOutlook({
      totalCapacity: 100,
      allocatedCapacity: 88,
      availableCapacity: 12,
      overloadedCapacity: 0,
      overloadedMembersCount: 2,
    });

    expect(summary.totalCapacity).toBe(100);
    expect(summary.allocatedCapacity).toBe(88);
    expect(summary.availableCapacity).toBe(12);
    expect(summary.overloadedMembersCount).toBe(2);
    expect(summary.utilizationPercent).toBe(88);
    expect(summary.tone).toBe("danger");
  });

  it("summarizes finance and capacity scenarios for management review", () => {
    const summary = summarizePortfolioScenarioOutlook({
      plannedBudget: 100_000_000,
      actualSpend: 72_000_000,
      portfolioCpi: 0.88,
      totalCapacity: 100,
      allocatedCapacity: 88,
    });

    expect(summary.finance.baselineForecastAtCompletion).toBe(113_636_364);
    expect(summary.finance.neutralForecastAtCompletion).toBe(100_000_000);
    expect(summary.finance.forecastDelta).toBe(13_636_364);
    expect(summary.finance.targetCpi).toBe(1);
    expect(summary.finance.tone).toBe("danger");

    expect(summary.capacity.currentUtilizationPercent).toBe(88);
    expect(summary.capacity.targetUtilizationPercent).toBe(80);
    expect(summary.capacity.targetAllocatedCapacity).toBe(80);
    expect(summary.capacity.utilizationGapCapacity).toBe(8);
    expect(summary.capacity.releaseNeededToTarget).toBe(8);
    expect(summary.capacity.spareCapacityToTarget).toBe(0);
    expect(summary.capacity.tone).toBe("warning");
  });
});
