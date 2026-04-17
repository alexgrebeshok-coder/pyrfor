import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";

import {
  readJsonBody,
  requiredJsonBodyOptions,
} from "@/lib/server/api-validation";

describe("readJsonBody", () => {
  it("returns undefined for an empty optional body", async () => {
    const result = await readJsonBody(
      new Request("http://localhost/api/test", {
        method: "POST",
        body: "",
      })
    );

    expect(result).toBeUndefined();
  });

  it("returns the configured emptyValue for an empty optional body", async () => {
    const emptyValue = { draft: true };

    const result = await readJsonBody(
      new Request("http://localhost/api/test", {
        method: "POST",
        body: "",
      }),
      { emptyValue }
    );

    expect(result).toBe(emptyValue);
  });

  it("returns a bad request response when the body is required", async () => {
    const result = await readJsonBody(
      new Request("http://localhost/api/test", {
        method: "POST",
        body: "",
      }),
      requiredJsonBodyOptions
    );

    expect(result instanceof NextResponse).toBe(true);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(400);
      const payload = (await result.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(payload.error?.code).toBe("REQUEST_BODY_REQUIRED");
      expect(payload.error?.message).toBe("Request body is required.");
    }
  });
});
