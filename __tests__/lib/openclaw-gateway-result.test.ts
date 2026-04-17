import { describe, expect, it } from "vitest";

import { parseGatewayResult } from "@/lib/ai/openclaw-gateway";

describe("parseGatewayResult", () => {
  it("parses the structured gateway JSON response", () => {
    const result = parseGatewayResult(
      JSON.stringify({
        title: "Budget review",
        summary: "Project budget is trending 8% above plan.",
        highlights: ["Cost growth is concentrated in procurement."],
        nextSteps: ["Review supplier change orders this week."],
      }),
      "run-1"
    );

    expect(result).toEqual(
      expect.objectContaining({
        title: "Budget review",
        summary: "Project budget is trending 8% above plan.",
        highlights: ["Cost growth is concentrated in procurement."],
        nextSteps: ["Review supplier change orders this week."],
      })
    );
  });

  it("falls back to plain text when the gateway does not return JSON", () => {
    const result = parseGatewayResult(
      "Something went wrong while processing your message. Please try again.",
      "run-2"
    );

    expect(result).toEqual(
      expect.objectContaining({
        title: "Something went wrong while processing your message. Please try again.",
        summary: "Something went wrong while processing your message. Please try again.",
        highlights: ["Something went wrong while processing your message. Please try again."],
        nextSteps: [],
        proposal: null,
      })
    );
  });

  it("extracts message content from partial OpenAI-compatible JSON", () => {
    const result = parseGatewayResult(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Critical risk: site handoff is slipping by 5 days.",
            },
          },
        ],
      }),
      "run-3"
    );

    expect(result).toEqual(
      expect.objectContaining({
        title: "Critical risk: site handoff is slipping by 5 days.",
        summary: "Critical risk: site handoff is slipping by 5 days.",
        highlights: ["Critical risk: site handoff is slipping by 5 days."],
        nextSteps: [],
        proposal: null,
      })
    );
  });
});
