import { describe, expect, it } from "vitest";

import { isPublicAppPath } from "@/lib/public-paths";

describe("public paths", () => {
  it("treats release center as a public route", () => {
    expect(isPublicAppPath("/release")).toBe(true);
  });

  it("keeps auth pages public", () => {
    expect(isPublicAppPath("/login")).toBe(true);
    expect(isPublicAppPath("/signup")).toBe(true);
  });
});
