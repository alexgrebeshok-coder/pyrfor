// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildKsReconciliationFinalReport,
  buildKsReconciliationReviewPack,
  loadKsReconciliationFixturePackage,
} from './ks-reconciliation-fixture';

describe('KS reconciliation fixture', () => {
  it('ships the Object A / June 2025 deterministic beachhead package', () => {
    const fixture = loadKsReconciliationFixturePackage();

    expect(fixture.scenario).toEqual({
      project: 'Object A',
      period: '2025-06',
      currency: 'RUB',
    });
    expect(fixture.documents.ks2.content.rows).toHaveLength(12);
    expect(fixture.documents.contract.content.rows).toHaveLength(15);
    expect(fixture.documents.odataV4.content.value).toHaveLength(18);
    expect(fixture.expectedFindings.map((finding) => finding.id)).toEqual(['D-01', 'D-02', 'D-03', 'D-04', 'D-05']);
  });

  it('builds a deterministic review pack with five evidence-backed findings', () => {
    const reviewPack = buildKsReconciliationReviewPack('run-ks-1');

    expect(reviewPack.findings.map((finding) => finding.ground_truth_id)).toEqual(['D-01', 'D-02', 'D-03', 'D-04', 'D-05']);
    expect(reviewPack.findings.every((finding) => finding.status === 'PENDING')).toBe(true);
    expect(reviewPack.findings.every((finding) => finding.evidence_ref.length > 0)).toBe(true);
    expect(reviewPack.metrics).toMatchObject({
      producedFindings: 5,
      expectedFindings: 5,
      precision: 1,
      recall: 1,
      falsePositives: 0,
      evidenceCoverage: 1,
    });
  });

  it('finalizes the report by bulk-accepting review-pack findings after approval', () => {
    const reviewPack = buildKsReconciliationReviewPack('run-ks-1');
    const report = buildKsReconciliationFinalReport('run-ks-1', 'ks-reconciliation-review-run-ks-1', reviewPack);

    expect(report.approval).toEqual({
      approvalId: 'ks-reconciliation-review-run-ks-1',
      decision: 'approve',
      reviewMode: 'pack_approval',
    });
    expect(report.findings.every((finding) => finding.status === 'ACCEPTED')).toBe(true);
    expect(report.summary.findingsAccepted).toBe(5);
  });
});
