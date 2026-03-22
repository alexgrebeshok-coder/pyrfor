import { safePercent } from "@/lib/utils";

export type PortfolioOutlookTone = "success" | "warning" | "danger";

export interface PortfolioFinanceOutlook {
  plannedBudget: number;
  actualSpend: number;
  forecastAtCompletion: number;
  forecastVariance: number;
  currentUsagePercent: number;
  forecastUsagePercent: number;
  remainingBudget: number;
  tone: PortfolioOutlookTone;
}

export interface PortfolioCapacityOutlook {
  totalCapacity: number;
  allocatedCapacity: number;
  availableCapacity: number;
  overloadedCapacity: number;
  utilizationPercent: number;
  overloadedMembersCount: number;
  tone: PortfolioOutlookTone;
}

export interface PortfolioScenarioFinanceOutlook {
  baselineForecastAtCompletion: number;
  neutralForecastAtCompletion: number;
  forecastDelta: number;
  targetCpi: number;
  tone: PortfolioOutlookTone;
}

export interface PortfolioScenarioCapacityOutlook {
  currentUtilizationPercent: number;
  targetUtilizationPercent: number;
  targetAllocatedCapacity: number;
  utilizationGapCapacity: number;
  spareCapacityToTarget: number;
  releaseNeededToTarget: number;
  tone: PortfolioOutlookTone;
}

export interface PortfolioScenarioOutlook {
  finance: PortfolioScenarioFinanceOutlook;
  capacity: PortfolioScenarioCapacityOutlook;
}

export function summarizePortfolioFinanceOutlook(input: {
  plannedBudget: number;
  actualSpend: number;
  portfolioCpi?: number | null;
}): PortfolioFinanceOutlook {
  const plannedBudget = Math.max(0, Math.round(input.plannedBudget));
  const actualSpend = Math.max(0, Math.round(input.actualSpend));
  const cpi = typeof input.portfolioCpi === "number" && Number.isFinite(input.portfolioCpi) && input.portfolioCpi > 0
    ? input.portfolioCpi
    : null;
  const forecastAtCompletion = plannedBudget > 0 && cpi ? Math.round(plannedBudget / cpi) : plannedBudget;
  const forecastVariance = forecastAtCompletion - plannedBudget;
  const currentUsagePercent = safePercent(actualSpend, plannedBudget);
  const forecastUsagePercent = safePercent(forecastAtCompletion, plannedBudget);
  const remainingBudget = Math.max(plannedBudget - actualSpend, 0);

  let tone: PortfolioOutlookTone = "success";
  if (forecastVariance > plannedBudget * 0.05) {
    tone = "danger";
  } else if (forecastVariance > 0) {
    tone = "warning";
  }

  return {
    plannedBudget,
    actualSpend,
    forecastAtCompletion,
    forecastVariance,
    currentUsagePercent,
    forecastUsagePercent,
    remainingBudget,
    tone,
  };
}

export function summarizePortfolioCapacityOutlook(input: {
  totalCapacity: number;
  allocatedCapacity: number;
  availableCapacity: number;
  overloadedCapacity: number;
  overloadedMembersCount: number;
}): PortfolioCapacityOutlook {
  const totalCapacity = Math.max(0, Math.round(input.totalCapacity));
  const allocatedCapacity = Math.max(0, Math.round(input.allocatedCapacity));
  const availableCapacity = Math.max(0, Math.round(input.availableCapacity));
  const overloadedCapacity = Math.max(0, Math.round(input.overloadedCapacity));
  const overloadedMembersCount = Math.max(0, Math.round(input.overloadedMembersCount));
  const utilizationPercent = totalCapacity > 0 ? safePercent(allocatedCapacity, totalCapacity) : 0;

  let tone: PortfolioOutlookTone = "success";
  if (overloadedMembersCount > 0 || overloadedCapacity > 0) {
    tone = "danger";
  } else if (utilizationPercent >= 85) {
    tone = "warning";
  }

  return {
    totalCapacity,
    allocatedCapacity,
    availableCapacity,
    overloadedCapacity,
    utilizationPercent,
    overloadedMembersCount,
    tone,
  };
}

export function summarizePortfolioScenarioOutlook(input: {
  plannedBudget: number;
  actualSpend: number;
  portfolioCpi?: number | null;
  totalCapacity: number;
  allocatedCapacity: number;
  targetUtilizationPercent?: number;
}): PortfolioScenarioOutlook {
  const finance = summarizePortfolioFinanceOutlook({
    plannedBudget: input.plannedBudget,
    actualSpend: input.actualSpend,
    portfolioCpi: input.portfolioCpi,
  });

  const targetCpi = 1;
  const baselineForecastAtCompletion = finance.forecastAtCompletion;
  const neutralForecastAtCompletion = Math.max(0, Math.round(finance.plannedBudget / targetCpi));
  const forecastDelta = baselineForecastAtCompletion - neutralForecastAtCompletion;

  const currentUtilizationPercent =
    input.totalCapacity > 0 ? safePercent(input.allocatedCapacity, input.totalCapacity) : 0;
  const targetUtilizationPercent = input.targetUtilizationPercent ?? 80;
  const targetAllocatedCapacity = Math.max(
    0,
    Math.round((input.totalCapacity * targetUtilizationPercent) / 100)
  );
  const utilizationGapCapacity = Math.max(0, Math.round(input.allocatedCapacity - targetAllocatedCapacity));
  const releaseNeededToTarget = utilizationGapCapacity;
  const spareCapacityToTarget = Math.max(0, Math.round(targetAllocatedCapacity - input.allocatedCapacity));

  let tone: PortfolioOutlookTone = "success";
  if (utilizationGapCapacity > input.totalCapacity * 0.1) {
    tone = "danger";
  } else if (utilizationGapCapacity > 0) {
    tone = "warning";
  }

  return {
    finance: {
      baselineForecastAtCompletion,
      neutralForecastAtCompletion,
      forecastDelta,
      targetCpi,
      tone: finance.tone,
    },
    capacity: {
      currentUtilizationPercent,
      targetUtilizationPercent,
      targetAllocatedCapacity,
      utilizationGapCapacity,
      spareCapacityToTarget,
      releaseNeededToTarget,
      tone,
    },
  };
}
