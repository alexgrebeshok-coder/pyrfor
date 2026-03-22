import assert from "node:assert/strict";

import {
  generatePortfolioBriefFromSnapshot,
  generateProjectBriefFromSnapshot,
} from "../briefs/generate";
import { buildMockExecutiveSnapshot } from "../briefs/snapshot";

async function main() {
  const referenceDate = new Date("2026-03-11T00:00:00.000Z");
  const snapshot = await buildMockExecutiveSnapshot({
    generatedAt: referenceDate,
  });

  const portfolioBrief = generatePortfolioBriefFromSnapshot(snapshot, {
    referenceDate,
  });

  assert.equal(portfolioBrief.kind, "portfolio");
  assert.ok(portfolioBrief.sections.whatHappened.length >= 3);
  assert.ok(portfolioBrief.sections.whyItMatters.length > 0);
  assert.ok(portfolioBrief.sections.recommendedActions.length > 0);
  assert.ok(portfolioBrief.topAlerts.length > 0);
  assert.match(portfolioBrief.formats.telegramDigest, /Что произошло:/u);
  assert.match(portfolioBrief.formats.emailDigest.body, /Что делать/u);

  const portfolioBriefEn = generatePortfolioBriefFromSnapshot(snapshot, {
    referenceDate,
    locale: "en",
  });

  assert.match(portfolioBriefEn.formats.telegramDigest, /What happened:/u);
  assert.match(portfolioBriefEn.formats.emailDigest.body, /Recommended actions/u);

  const projectBrief = generateProjectBriefFromSnapshot(snapshot, "p6", {
    referenceDate,
  });

  assert.equal(projectBrief.kind, "project");
  assert.equal(projectBrief.project.id, "p6");
  assert.ok(projectBrief.topAlerts.length > 0);
  assert.ok(projectBrief.sections.whatHappened.length >= 3);
  assert.match(projectBrief.summary, /Статус/u);
  assert.match(projectBrief.formats.emailDigest.body, /Почему это важно/u);

  const projectBriefEn = generateProjectBriefFromSnapshot(snapshot, "p6", {
    referenceDate,
    locale: "en",
  });

  assert.match(projectBriefEn.summary, /overdue tasks/u);
  assert.match(projectBriefEn.formats.emailDigest.body, /Why it matters/u);

  console.log("PASS brief-generators.unit");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
