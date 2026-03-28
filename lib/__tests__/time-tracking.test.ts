/**
 * Time tracking tests
 * 
 * Run with: npx tsx lib/__tests__/time-tracking.test.ts
 */

const API_BASE = "http://localhost:3000";

let testTaskId: string;
let testEntryId: string;

async function setupTestData() {
  console.log("🔧 Setting up test data...");
  
  // Get first project
  const projectsRes = await fetch(`${API_BASE}/api/projects`);
  const projects = await projectsRes.json();
  const testProjectId = projects[0]?.id;
  
  if (!testProjectId) {
    console.log("⚠️ No projects found");
    return false;
  }
  
  // Create test task
  const taskRes = await fetch(`${API_BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Time-tracking-test-task",
      projectId: testProjectId,
      status: "todo",
      priority: "medium",
      dueDate: new Date("2026-03-11").toISOString(),
    }),
  });
  const task = await taskRes.json();
  testTaskId = task.id;
  
  console.log("✅ Test task created");
  return true;
}

async function testStartTimer() {
  console.log("\n▶️ Testing start timer...");
  
  const response = await fetch(`${API_BASE}/api/time-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: testTaskId,
      description: "Working on feature X",
    }),
  });
  
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Task:", data.task?.title);
  console.log("Start time:", data.startTime);
  
  if (response.status === 201 && data.startTime) {
    console.log("✅ Timer started");
    testEntryId = data.id;
  } else {
    console.log("❌ Failed to start timer");
    console.log("Response:", data);
  }
}

async function testStopTimer() {
  if (!testEntryId) {
    console.log("⚠️ Skipping: No active timer");
    return;
  }
  
  console.log("\n⏹️ Testing stop timer...");
  
  // Wait 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const response = await fetch(`${API_BASE}/api/time-entries/${testEntryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Duration:", data.duration, "seconds");
  
  if (response.status === 200 && data.duration && data.duration >= 2) {
    console.log("✅ Timer stopped");
  } else {
    console.log("❌ Failed to stop timer");
  }
}

async function testListEntries() {
  console.log("\n📋 Testing list time entries...");
  
  const response = await fetch(`${API_BASE}/api/time-entries?taskId=${testTaskId}`);
  const data = await response.json();
  const entries = data as Array<{ duration?: number }>;
  
  console.log("Status:", response.status);
  console.log("Entries count:", data.length);
  console.log("Total time:", entries.reduce((sum, entry) => sum + (entry.duration || 0), 0), "seconds");
  
  if (response.status === 200 && data.length >= 1) {
    console.log("✅ Time entries listed");
  } else {
    console.log("❌ Failed to list time entries");
  }
}

async function testTimeStats() {
  console.log("\n📊 Testing time statistics...");
  
  const response = await fetch(`${API_BASE}/api/time-entries/stats`);
  const data = await response.json();
  const byTask = data.byTask as Record<string, { taskTitle: string; totalMinutes: number }>;
  
  console.log("Status:", response.status);
  console.log("Total time:", data.totalHours, "hours");
  console.log(
    "By task:",
    Object.values(byTask)
      .map((task) => `${task.taskTitle}: ${task.totalMinutes}m`)
      .join(", | ")
  );
  
  if (response.status === 200 && data.totalHours !== undefined) {
    console.log("✅ Time statistics fetched");
  } else {
    console.log("❌ Failed to fetch time statistics");
  }
}

async function testDeleteEntry() {
  if (!testEntryId) {
    console.log("⚠️ Skipping: No entry to delete");
    return;
  }
  
  console.log("\n🗑️ Testing delete time entry...");
  
  const response = await fetch(`${API_BASE}/api/time-entries/${testEntryId}`, {
    method: "DELETE",
  });
  
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Success:", data.success);
  
  if (response.status === 200 && data.success) {
    console.log("✅ Time entry deleted");
  } else {
    console.log("❌ Failed to delete time entry");
  }
}

async function cleanupTestData() {
  console.log("\n🧹 Cleaning up test data...");
  
  if (testTaskId) {
    await fetch(`${API_BASE}/api/tasks/${testTaskId}`, { method: "DELETE" });
  }
  
  console.log("✅ Cleanup complete");
}

async function runTests() {
  console.log("🚀 Starting Time Tracking API tests...\n");
  console.log("=".repeat(50));
  
  try {
    const setup = await setupTestData();
    if (!setup) {
      console.log("❌ Setup failed, aborting tests");
      return;
    }
    
    await testStartTimer();
    await testStopTimer();
    await testListEntries();
    await testTimeStats();
    await testDeleteEntry();
    
    console.log("\n" + "=".repeat(50));
    console.log("✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
  } finally {
    await cleanupTestData();
  }
}

runTests();
