import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalQueue } from "@/components/approvals/approval-queue";

let canReviewApprovals = false;

vi.mock("@/lib/hooks/use-platform-permission", () => ({
  usePlatformPermission: () => ({
    allowed: canReviewApprovals,
  }),
}));

describe("ApprovalQueue", () => {
  beforeEach(() => {
    canReviewApprovals = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          approvals: [
            {
              id: "approval-1",
              type: "task_creation",
              entityType: "task",
              entityId: "task-1",
              title: "Create crane permit task",
              description: "Needs review before scheduling.",
              status: "pending",
              comment: null,
              metadata: null,
              createdAt: "2026-03-25T03:00:00.000Z",
              reviewedAt: null,
              requestedBy: {
                id: "user-1",
                name: "Alex",
                email: "alex@example.com",
              },
              reviewedBy: null,
            },
          ],
          total: 1,
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("degrades pending approval actions when review permission is missing", async () => {
    render(<ApprovalQueue />);

    expect(
      await screen.findByText(/Review controls доступны только ролям с правом RUN_AI_ACTIONS/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Рассмотреть/i })).not.toBeInTheDocument();
  });
});
