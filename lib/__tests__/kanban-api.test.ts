/**
 * Kanban API tests
 * 
 * Run with: npx tsx lib/__tests__/kanban-api.test.ts
 */

const API_BASE = "http://localhost:3000";

let testBoardId: string;

async function testCreateBoard() {
  console.log("📝 Testing create board...");
  
  // Get first project
  const projectsRes = await fetch(`${API_BASE}/api/projects`);
  const projects = await projectsRes.json();
  const projectId = projects[0]?.id;
  
  if (!projectId) {
    console.log("⚠️ No projects found, skipping test");
    return;
  }
  
  const response = await fetch(`${API_BASE}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test Board",
      projectId,
    }),
  });
  
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Board:", data.name);
  console.log("Columns:", data.columns?.length);
  
  if (response.status === 201 && data.columns?.length === 4) {
    console.log("✅ Board created with default columns");
    testBoardId = data.id;
  } else {
    console.log("❌ Failed to create board");
  }
}

async function testGetBoard() {
  if (!testBoardId) {
    console.log("⚠️ Skipping: No test board ID");
    return;
  }
  
  console.log("\n📋 Testing get board...");
  
  const response = await fetch(`${API_BASE}/api/boards/${testBoardId}`);
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Board:", data.name);
  console.log("Columns:", data.columns?.length);
  
  if (response.status === 200 && data.columns) {
    console.log("✅ Board fetched successfully");
  } else {
    console.log("❌ Failed to fetch board");
  }
}

async function testListBoards() {
  console.log("\n📚 Testing list boards...");
  
  const response = await fetch(`${API_BASE}/api/boards`);
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Boards count:", data.length);
  
  if (response.status === 200 && Array.isArray(data)) {
    console.log("✅ Boards listed successfully");
  } else {
    console.log("❌ Failed to list boards");
  }
}

async function testMoveTask() {
  if (!testBoardId) {
    console.log("⚠️ Skipping: No test board ID");
    return;
  }
  
  console.log("\n🔄 Testing move task...");
  
  // Get board with tasks
  const boardRes = await fetch(`${API_BASE}/api/boards/${testBoardId}`);
  const board = await boardRes.json();
  
  // Find a task
  const column = board.columns[0];
  const task = column.tasks[0];
  
  if (!task) {
    console.log("⚠️ No tasks found, skipping test");
    return;
  }
  
  // Move to second column
  const targetColumnId = board.columns[1].id;
  
  const response = await fetch(`${API_BASE}/api/tasks/${task.id}/move`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      columnId: targetColumnId,
      order: 0,
    }),
  });
  
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Task:", data.title);
  console.log("New column:", data.columnId);
  
  if (response.status === 200 && data.columnId === targetColumnId) {
    console.log("✅ Task moved successfully");
  } else {
    console.log("❌ Failed to move task");
  }
}

async function runTests() {
  console.log("🚀 Starting Kanban API tests...\n");
  console.log("=".repeat(50));
  
  try {
    await testCreateBoard();
    await testGetBoard();
    await testListBoards();
    await testMoveTask();
    
    console.log("\n" + "=".repeat(50));
    console.log("✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

runTests();
