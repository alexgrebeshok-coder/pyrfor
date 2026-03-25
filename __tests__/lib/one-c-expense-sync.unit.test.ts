import { describe, expect, it } from "vitest";

import { mapRecordToExpenseItem } from "@/lib/connectors/one-c-expense-sync";
import type { OneCProjectFinanceTruth } from "@/lib/connectors/one-c-client";

function createRecord(overrides: Partial<OneCProjectFinanceTruth> = {}): OneCProjectFinanceTruth {
  return {
    source: "one-c",
    projectKey: "proj-yanao-001",
    projectId: "external-1c-id",
    projectName: "Yamal Earthwork Package",
    status: "watch",
    currency: "RUB",
    reportDate: "2026-03-12",
    plannedBudget: 125000000,
    actualBudget: 118000000,
    paymentsActual: 79000000,
    actsActual: 71000000,
    variance: 7000000,
    variancePercent: 0.056,
    observedAt: "2026-03-12T00:00:00.000Z",
    actualToPlanRatio: 0.944,
    paymentsToActualRatio: 0.669,
    actsToActualRatio: 0.602,
    paymentGap: 39000000,
    actGap: 47000000,
    paymentsVsActsGap: 8000000,
    budgetDeltaStatus: "under_plan",
    ...overrides,
  };
}

describe("mapRecordToExpenseItem", () => {
  it("maps by project name when ids differ", () => {
    const item = mapRecordToExpenseItem(createRecord(), [
      { id: "internal-project", name: "Yamal Earthwork Package" },
    ]);

    expect(item.action).toBe("upsert");
    expect(item.matchedProjectId).toBe("internal-project");
    expect(item.oneCRef).toBe("one-c:proj-yanao-001:actual-budget");
    expect(item.amount).toBe(118000000);
  });

  it("skips when project mapping is missing", () => {
    const item = mapRecordToExpenseItem(createRecord(), []);

    expect(item.action).toBe("skip");
    expect(item.reason).toBe("Project mapping not found");
  });
});
