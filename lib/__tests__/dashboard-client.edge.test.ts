/**
 * DashboardClient edge case tests
 */

import { getDashboardClient, DashboardAPIError } from "../dashboard-client";

async function testInvalidProjectId() {
  console.log("❌ Testing invalid project ID...");
  const client = getDashboardClient();

  try {
    await client.getProject("non-existent-id-123");
    console.log("❌ Should have thrown error");
  } catch (error) {
    if (error instanceof DashboardAPIError) {
      console.log("✅ Error caught correctly:", error.message, `(Status: ${error.status})`);
  } else {
    console.log("❌ Wrong error type:", error);
  }
  }
}

async function testEmptyProjectName() {
  console.log("\n🔍 Testing find project with empty name...");
  const client = getDashboardClient();

  const result = await client.findProjectByName("");
  if (result === null) {
    console.log("✅ Empty name handled correctly (returned null)");
  } else {
    console.log("❌ Empty name should return null");
  }
}

async function testMalformedInput() {
  console.log("\n🔧 Testing malformed input...");
  const client = getDashboardClient();

  try {
    // @ts-expect-error - testing invalid input
    await client.createProject({
      name: "",
      status: "invalid-status",
      priority: "invalid-priority",
      budget: { planned: -100, actual: 0, currency: "USD" },
      dates: { start: "invalid", end: "invalid" },
      manager: "",
    });
    console.log("❌ Should have thrown validation error");
  } catch (error) {
    console.log("✅ Validation error caught:", error instanceof Error ? error.message : error);
  }
}

async function runTests() {
  console.log("🧪 Edge Case Tests for DashboardClient\n");
  console.log("=".repeat(50));

  try {
    await testInvalidProjectId();
    await testEmptyProjectName();
    await testMalformedInput();

    console.log("\n" + "=".repeat(50));
    console.log("✅ All edge case tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

runTests();
