import { describe, expect, it } from "vitest";

import {
  ensureBuiltinPluginsRegistered,
  executePlugin,
  registerPlugin,
} from "@/lib/ai/plugin-system";

describe("plugin-system", () => {
  it("registers and executes builtin plugins", async () => {
    ensureBuiltinPluginsRegistered();

    await expect(executePlugin("get_current_datetime", {})).resolves.toMatchObject({
      success: true,
    });
    await expect(executePlugin("calculate", { expression: "(10+5)*2" })).resolves.toMatchObject({
      success: true,
    });
  });

  it("keeps admin plugins behind explicit override", async () => {
    registerPlugin(
      {
        name: "admin_probe_vitest",
        version: "1.0.0",
        description: "admin-only plugin for tests",
        enabled: true,
        safetyLevel: "admin",
      },
      {
        name: "admin_probe_vitest",
        description: "admin-only plugin for tests",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => ({
          success: true,
          data: { ok: true },
        }),
      }
    );

    await expect(executePlugin("admin_probe_vitest", {})).resolves.toMatchObject({
      success: false,
    });
  });
});
