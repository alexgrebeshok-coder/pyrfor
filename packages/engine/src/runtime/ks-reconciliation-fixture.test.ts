// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildKsReconciliationFinalReport,
  buildKsReconciliationReviewPack,
  loadKsReconciliationFixturePackage,
  reviewKsReconciliationFinding,
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
    expect(reviewPack.findings.every((finding) => (
      finding.reviewer_id === null
      && finding.reviewed_at === null
      && finding.reviewer_action === null
      && finding.reviewer_comment === null
    ))).toBe(true);
    expect(reviewPack.reviewHistory).toEqual([]);
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

  it('applies per-finding review actions with reviewer metadata and audit history', () => {
    let reviewPack = buildKsReconciliationReviewPack('run-ks-1');
    reviewPack = reviewKsReconciliationFinding(reviewPack, {
      findingId: 'F-001',
      action: 'accept',
      reviewerId: 'operator-1',
      reviewedAt: '2026-05-15T01:00:00.000Z',
      reviewerComment: 'Confirmed against signed totals.',
    });
    reviewPack = reviewKsReconciliationFinding(reviewPack, {
      findingId: 'F-002',
      action: 'reject',
      reviewerId: 'operator-2',
      reviewedAt: '2026-05-15T01:05:00.000Z',
      reviewerComment: 'Contract amendment approved the higher quantity.',
    });
    reviewPack = reviewKsReconciliationFinding(reviewPack, {
      findingId: 'F-003',
      action: 'defer',
      reviewerId: 'operator-3',
      reviewedAt: '2026-05-15T01:10:00.000Z',
    });
    reviewPack = reviewKsReconciliationFinding(reviewPack, {
      findingId: 'F-004',
      action: 'escalate',
      reviewerId: 'operator-4',
      reviewedAt: '2026-05-15T01:15:00.000Z',
      reviewerComment: 'Escalate to contract governance.',
    });

    expect(reviewPack.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        finding_id: 'F-001',
        status: 'ACCEPTED',
        reviewer_id: 'operator-1',
        reviewed_at: '2026-05-15T01:00:00.000Z',
        reviewer_action: 'accept',
        reviewer_comment: 'Confirmed against signed totals.',
      }),
      expect.objectContaining({
        finding_id: 'F-002',
        status: 'REJECTED',
        reviewer_id: 'operator-2',
        reviewed_at: '2026-05-15T01:05:00.000Z',
        reviewer_action: 'reject',
        reviewer_comment: 'Contract amendment approved the higher quantity.',
      }),
      expect.objectContaining({
        finding_id: 'F-003',
        status: 'DEFERRED',
        reviewer_id: 'operator-3',
        reviewed_at: '2026-05-15T01:10:00.000Z',
        reviewer_action: 'defer',
        reviewer_comment: null,
      }),
      expect.objectContaining({
        finding_id: 'F-004',
        status: 'ESCALATED',
        reviewer_id: 'operator-4',
        reviewed_at: '2026-05-15T01:15:00.000Z',
        reviewer_action: 'escalate',
        reviewer_comment: 'Escalate to contract governance.',
      }),
    ]));
    expect(reviewPack.reviewHistory).toEqual([
      expect.objectContaining({ finding_id: 'F-001', action: 'accept', reviewer_id: 'operator-1' }),
      expect.objectContaining({ finding_id: 'F-002', action: 'reject', reviewer_id: 'operator-2' }),
      expect.objectContaining({ finding_id: 'F-003', action: 'defer', reviewer_id: 'operator-3' }),
      expect.objectContaining({ finding_id: 'F-004', action: 'escalate', reviewer_id: 'operator-4' }),
    ]);
  });

  it('requires a comment when rejecting a finding', () => {
    const reviewPack = buildKsReconciliationReviewPack('run-ks-1');
    expect(() => reviewKsReconciliationFinding(reviewPack, {
      findingId: 'F-001',
      action: 'reject',
      reviewerId: 'operator-1',
      reviewedAt: '2026-05-15T01:00:00.000Z',
    })).toThrow('reviewerComment');
  });

  it('blocks final report generation until every finding is reviewed', () => {
    const reviewPack = buildKsReconciliationReviewPack('run-ks-1');
    expect(() => buildKsReconciliationFinalReport('run-ks-1', 'ks-reconciliation-review-run-ks-1', reviewPack))
      .toThrow('requires review for all findings');
  });

  it('finalizes the report after all findings are reviewed', () => {
    let reviewPack = buildKsReconciliationReviewPack('run-ks-1');
    const actions = [
      ['F-001', 'accept', 'Confirmed discrepancy'],
      ['F-002', 'reject', 'Quantity variance was approved'],
      ['F-003', 'defer', undefined],
      ['F-004', 'escalate', 'Needs finance follow-up'],
      ['F-005', 'accept', 'Missing line item confirmed'],
    ] as const;
    reviewPack = actions.reduce((currentPack, [findingId, action, reviewerComment], index) => (
      reviewKsReconciliationFinding(currentPack, {
        findingId,
        action,
        reviewerId: `operator-${index + 1}`,
        reviewedAt: `2026-05-15T01:0${index}:00.000Z`,
        reviewerComment,
      })
    ), reviewPack);
    const report = buildKsReconciliationFinalReport('run-ks-1', 'ks-reconciliation-review-run-ks-1', reviewPack);

    expect(report.approval).toEqual({
      approvalId: 'ks-reconciliation-review-run-ks-1',
      decision: 'approve',
      reviewMode: 'pack_approval',
    });
    expect(report.findings.map((finding) => finding.status)).toEqual(['ACCEPTED', 'REJECTED', 'DEFERRED', 'ESCALATED', 'ACCEPTED']);
    expect(report.summary).toMatchObject({
      findingsAccepted: 2,
      findingsReviewed: 5,
      reviewCounts: {
        ACCEPTED: 2,
        REJECTED: 1,
        DEFERRED: 1,
        ESCALATED: 1,
      },
    });
  });
});
