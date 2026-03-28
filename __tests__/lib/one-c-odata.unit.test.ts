import { describe, expect, it } from "vitest";

import {
  buildOneCODataEntityUrl,
  getOneCODataSnapshot,
} from "@/lib/connectors/one-c-odata";

describe("one-c-odata", () => {
  it("builds entity urls with query params", () => {
    const url = buildOneCODataEntityUrl(
      "https://erp.example.com/odata/standard.odata",
      "Catalog_Контрагенты",
      { $top: 5, $select: "Ref_Key,Description" }
    );

    expect(url).toContain("/odata/standard.odata/Catalog_%D0%9A%D0%BE%D0%BD%D1%82%D1%80%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D1%8B");
    expect(url).toContain("%24top=5");
    expect(url).toContain("%24select=Ref_Key%2CDescription");
  });

  it("returns pending snapshot when odata config is missing", async () => {
    const snapshot = await getOneCODataSnapshot({ NODE_ENV: "test" });

    expect(snapshot.status).toBe("pending");
    expect(snapshot.configured).toBe(false);
    expect(snapshot.missingSecrets.length).toBeGreaterThan(0);
  });
});
