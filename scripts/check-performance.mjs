#!/usr/bin/env node
/**
 * Performance budget checker.
 *
 * Defines performance budgets for key pages. Use with Lighthouse CI:
 *   npx lhci autorun --config=lighthouserc.json
 *
 * Or run this script for a summary of defined budgets:
 *   node scripts/check-performance.mjs
 */

const PAGES = ["/", "/projects", "/tasks", "/goals", "/chat"];

const BUDGETS = {
  lcp: 2500, // ms — Largest Contentful Paint
  cls: 0.1, // Cumulative Layout Shift
  fcp: 1800, // ms — First Contentful Paint
  si: 3400, // ms — Speed Index
};

console.log("CEOClaw Performance Budget");
console.log("=========================\n");
console.log("Thresholds:");
console.log(`  LCP  < ${BUDGETS.lcp}ms`);
console.log(`  CLS  < ${BUDGETS.cls}`);
console.log(`  FCP  < ${BUDGETS.fcp}ms`);
console.log(`  SI   < ${BUDGETS.si}ms`);
console.log(`\nMonitored pages: ${PAGES.join(", ")}`);
console.log("\nTo run Lighthouse CI:");
console.log("  npx lhci autorun --config=lighthouserc.json");
