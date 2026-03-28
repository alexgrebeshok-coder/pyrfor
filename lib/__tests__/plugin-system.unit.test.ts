import assert from "node:assert/strict";

import {
  ensureBuiltinPluginsRegistered,
  executePlugin,
  registerPlugin,
} from "@/lib/ai/plugin-system";

async function testBuiltinsRegisterAndExecute() {
  ensureBuiltinPluginsRegistered();

  const datetime = await executePlugin("get_current_datetime", {});
  assert.equal(datetime.success, true);

  const calc = await executePlugin("calculate", { expression: "(10+5)*2" });
  assert.equal(calc.success, true);
}

async function testAdminPluginsStayGuarded() {
  registerPlugin(
    {
      name: "admin_probe_test",
      version: "1.0.0",
      description: "admin-only test plugin",
      enabled: true,
      safetyLevel: "admin",
    },
    {
      name: "admin_probe_test",
      description: "admin-only test plugin",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({
        success: true,
        data: { ok: true },
      }),
    }
  );

  const blocked = await executePlugin("admin_probe_test", {});
  assert.equal(blocked.success, false);
  assert.match(blocked.error ?? "", /requires admin safety override/);
}

async function run() {
  await testBuiltinsRegisterAndExecute();
  await testAdminPluginsStayGuarded();
  console.log("PASS plugin-system.unit");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
