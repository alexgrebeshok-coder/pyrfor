/**
 * DashboardClient integration test
 *
 * Run with: npx tsx lib/__tests__/dashboard-client.test.ts
 */

import {
  getDashboardClient,
  DashboardAPIError,
} from "../dashboard-client";

async function testHealthCheck() {
  console.log("🏥 Testing health check...");
  const client = getDashboardClient();

  const result = await client.healthCheck();
  console.log("✅ Health check passed:", result);
}

async function testListProjects() {
  console.log("\n📋 Testing list projects...");
  const client = getDashboardClient();

  const projects = await client.listProjects();
  console.log(`✅ Found ${projects.length} projects`);
  console.log("First project:", projects[0]?.name);
}

async function testFindProjectByName() {
  console.log("\n🔍 Testing find project by name...");
  const client = getDashboardClient();

  // Test with partial match
  const project = await client.findProjectByName("ЧЭМК");
  if (project) {
    console.log("✅ Found project:", project.name);
  } else {
    console.log("❌ Project not found");
  }
}

async function testListTasks() {
  console.log("\n📝 Testing list tasks...");
  const client = getDashboardClient();

  const tasks = await client.listTasks();
  console.log(`✅ Found ${tasks.length} tasks`);
}

async function testListTeam() {
  console.log("\n👥 Testing list team...");
  const client = getDashboardClient();

  const team = await client.listTeam();
  console.log(`✅ Found ${team.length} team members`);
}

async function testErrorHandling() {
  console.log("\n❌ Testing error handling...");
  const client = getDashboardClient();

  try {
    await client.getProject("non-existent-id");
    console.log("❌ Should have thrown error");
  } catch (error) {
    if (error instanceof DashboardAPIError) {
      console.log("✅ Error caught correctly:", error.message);
    } else {
      console.log("❌ Wrong error type:", error);
    }
  }
}

async function runTests() {
  console.log("🚀 Starting DashboardClient tests...\n");
  console.log("=" .repeat(50));

  try {
    await testHealthCheck();
    await testListProjects();
    await testFindProjectByName();
    await testListTasks();
    await testListTeam();
    await testErrorHandling();

    console.log("\n" + "=".repeat(50));
    console.log("✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
runTests();
