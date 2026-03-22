import assert from "node:assert/strict";

import { buildAlertFeed, buildProjectAlerts, scoreAlert } from "../alerts/scoring";
import { buildMockExecutiveSnapshot } from "../briefs/snapshot";

async function main() {
  const referenceDate = new Date("2026-03-11T00:00:00.000Z");
  const snapshot = await buildMockExecutiveSnapshot({
    generatedAt: referenceDate,
  });

  const riskyProjectAlerts = buildProjectAlerts(snapshot, "p6", {
    referenceDate,
  });

  assert.ok(riskyProjectAlerts.length >= 2);
  assert.equal(riskyProjectAlerts[0].projectId, "p6");
  assert.ok(riskyProjectAlerts.some((alert) => alert.category === "budget"));
  assert.ok(riskyProjectAlerts.some((alert) => alert.category === "risk"));
  assert.ok(
    riskyProjectAlerts[0].score >= riskyProjectAlerts[riskyProjectAlerts.length - 1].score
  );
  assert.match(riskyProjectAlerts[0].title, /[А-Яа-яЁё]/u);

  const newerAlert = scoreAlert(
    {
      id: "fresh-alert",
      scope: "project",
      category: "schedule",
      severity: "high",
      confidence: 0.85,
      projectId: "p1",
      projectName: "Test project",
      title: "Fresh signal",
      summary: "Fresh signal summary",
      whyItMatters: "Fresh signal impact",
      recommendedAction: "Fresh signal action",
      detectedAt: "2026-03-10T00:00:00.000Z",
    },
    referenceDate
  );
  const olderAlert = scoreAlert(
    {
      id: "stale-alert",
      scope: "project",
      category: "schedule",
      severity: "high",
      confidence: 0.85,
      projectId: "p1",
      projectName: "Test project",
      title: "Stale signal",
      summary: "Stale signal summary",
      whyItMatters: "Stale signal impact",
      recommendedAction: "Stale signal action",
      detectedAt: "2026-02-01T00:00:00.000Z",
    },
    referenceDate
  );

  assert.ok(newerAlert.freshness > olderAlert.freshness);
  assert.ok(newerAlert.score > olderAlert.score);

  const portfolioFeed = buildAlertFeed(snapshot, {
    referenceDate,
    limit: 5,
  });

  assert.ok(portfolioFeed.summary.total > 0);
  assert.ok(portfolioFeed.summary.critical >= 1);
  assert.ok(portfolioFeed.recommendationsSummary.length > 0);
  assert.equal(portfolioFeed.scope, "portfolio");
  assert.match(portfolioFeed.recommendationsSummary[0], /[А-Яа-яЁё]/u);

  const portfolioFeedEn = buildAlertFeed(snapshot, {
    referenceDate,
    limit: 5,
    locale: "en",
  });

  assert.match(portfolioFeedEn.recommendationsSummary[0], /Freeze|Review|Treat/u);

  console.log("PASS alert-scoring.unit");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
