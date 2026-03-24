/**
 * AI Predictions + Recommendations tests
 * 
 * Run with: npx tsx lib/__tests__/predictions.test.ts
 */

const API_BASE = "http://localhost:3000";

async function testPredictions() {
  console.log("🔮 Testing AI predictions...");
  
  const response = await fetch(`${API_BASE}/api/analytics/predictions`);
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Summary:", data.summary);
  console.log("Predictions count:", data.predictions?.length);
  
  if (response.status === 200 && data.predictions && data.summary) {
    console.log("✅ Predictions generated");
    
    // Show first prediction details
    if (data.predictions.length > 0) {
      const p = data.predictions[0];
      console.log("  First project:", p.projectName);
      console.log("  Risk score:", p.risks.overall);
      console.log("  Velocity:", p.predictions.velocity);
    }
  } else {
    console.log("❌ Failed to generate predictions");
    console.log("Response:", data);
  }
}

async function testRecommendations() {
  console.log("\n💡 Testing AI recommendations...");
  
  const response = await fetch(`${API_BASE}/api/analytics/recommendations`);
  const data = await response.json();
  
  console.log("Status:", response.status);
  console.log("Summary:", data.summary);
  console.log("Recommendations count:", data.recommendations?.length);
  
  if (response.status === 200 && data.recommendations && data.summary) {
    console.log("✅ Recommendations generated");
    
    // Show first few recommendations
    if (data.recommendations.length > 0) {
      console.log("  Top recommendations:");
      data.recommendations.slice(0, 3).forEach((r: { priority: string; title: string }, i: number) => {
        console.log(`    ${i + 1}. [${r.priority.toUpperCase()}] ${r.title}`);
      });
    }
  } else {
    console.log("❌ Failed to generate recommendations");
    console.log("Response:", data);
  }
}

async function runTests() {
  console.log("🚀 Starting AI Predictions + Recommendations tests...\n");
  console.log("=".repeat(50));
  
  try {
    await testPredictions();
    await testRecommendations();
    
    console.log("\n" + "=".repeat(50));
    console.log("✅ All AI tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
  }
}

runTests();
