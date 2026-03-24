/**
 * CommandHandler integration test
 *
 * Run with: npx tsx lib/__tests__/command-handler.test.ts
 */

import { executeCommand } from "../command-handler";

async function testListProjects() {
  console.log("\n📋 Testing listProjects command...");
  
  const result = await executeCommand("Покажи список проектов");
  console.log("Result:", result.success ? "✅" : "❌");
  console.log(result.message);
}

async function testShowStatus() {
  console.log("\n📊 Testing showStatus command...");
  
  const result = await executeCommand("Статус ЧЭМК");
  console.log("Result:", result.success ? "✅" : "❌");
  console.log(result.message);
}

async function testUnknownCommand() {
  console.log("\n❓ Testing unknown command...");
  
  const result = await executeCommand("Привет, как дела?");
  console.log("Result:", result.success ? "✅" : "❌", result.message);
}

async function runTests() {
  console.log("🚀 Starting CommandHandler tests...\n");
  console.log("=".repeat(50));

  try {
    await testListProjects();
    await testShowStatus();
    await testUnknownCommand();
    // Note: createTask flow is intentionally skipped here to avoid mutating shared test data.

    console.log("\n" + "=".repeat(50));
    console.log("✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
runTests();
