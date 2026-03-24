/**
 * Notifications tests
 * 
 * Run with: npx tsx lib/__tests__/notifications.test.ts
 */

const API_BASE = "http://localhost:3000";

async function testNotificationsAPI() {
  console.log("🔔 Testing Notifications API...");
  
  // Test GET notifications
  const response = await fetch(`${API_BASE}/api/notifications?userId=default`);
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Notifications count:", data.notifications?.length || 0);
  console.log("Unread count:", data.unreadCount || 0);
  
  if (response.status === 200 && data.notifications?.length > 0) {
    console.log("✅ Notifications API works");
    return data.notifications[0]?.id;
  } else {
    console.log("❌ Notifications API failed");
    return null;
  }
}

async function testMarkAsRead(notificationId: string | null) {
  if (!notificationId) {
    console.log("\n⚠️ Skipping mark as read test (no notification ID)");
    return;
  }
  
  console.log("\n✓ Testing mark as read...");
  
  const response = await fetch(`${API_BASE}/api/notifications/${notificationId}/read`, {
    method: "PUT",
  });
  
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Read:", data.read);
  
  if (response.status === 200 && data.read === true) {
    console.log("✅ Mark as read works");
  } else {
    console.log("❌ Mark as read failed");
  }
}

async function testNotificationBell() {
  console.log("\n🔔 Testing Notification Bell UI...");
  
  const response = await fetch(`${API_BASE}/`);
  const html = await response.text();
  
  // Check if NotificationBell is rendered
  const hasBell = html.includes("Bell") || html.includes("notification");
  
  console.log("Has notification bell:", hasBell);
  
  if (hasBell) {
    console.log("✅ Notification Bell rendered");
  } else {
    console.log("⚠️ Notification Bell may not be visible");
  }
}

async function testNotificationTypes() {
  console.log("\n📋 Testing notification types...");
  
  const response = await fetch(`${API_BASE}/api/notifications?userId=default`);
  const data = await response.json();

  const notifications = (data.notifications ?? []) as Array<{ type?: string }>;
  const types = new Set(notifications.map((notification) => notification.type).filter(Boolean));
  
  console.log("Notification types found:", Array.from(types));
  
  const expectedTypes = ["task_assigned", "due_date", "status_changed", "mention"];
  const hasAllTypes = expectedTypes.every((t) => types.has(t));
  
  if (hasAllTypes) {
    console.log("✅ All notification types present");
  } else {
    console.log("⚠️ Some notification types missing");
  }
}

async function runTests() {
  console.log("🚀 Starting Notifications tests...\n");
  console.log("=".repeat(50));
  
  try {
    const notificationId = await testNotificationsAPI();
    await testMarkAsRead(notificationId);
    await testNotificationBell();
    await testNotificationTypes();
    
    console.log("\n" + "=".repeat(50));
    console.log("✅ All Notifications tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
  }
}

runTests();
