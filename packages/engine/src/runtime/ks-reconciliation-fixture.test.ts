// @vitest-environment node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildKsReconciliationFinalReport,
  buildKsReconciliationReviewPack,
  loadKsReconciliationFixturePackage,
  reviewKsReconciliationFinding,
} from './ks-reconciliation-fixture';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/reconciliation-mvp');

function fileSha256(fileName: string): string {
  return createHash('sha256').update(fs.readFileSync(path.join(FIXTURE_DIR, fileName))).digest('hex');
}

function createFixtureOverride(overrides: Record<string, string | Buffer>): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyrfor-ks-fixture-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
  for (const [fileName, content] of Object.entries(overrides)) {
    fs.writeFileSync(path.join(tempDir, fileName), content);
  }
  return tempDir;
}

describe('KS reconciliation fixture', () => {
  it('matches expected_findings.json ground-truth ids and types', () => {
    const reviewPack = buildKsReconciliationReviewPack('run-fixture-gate');
    const expected = JSON.parse(
      readFileSync(path.join(FIXTURE_DIR, 'expected_findings.json'), 'utf8'),
    ) as { expectedFindings: Array<{ id: string; finding_type: string }> };

    expect(reviewPack.findings).toHaveLength(expected.expectedFindings.length);
    expect(reviewPack.findings.map((finding) => finding.ground_truth_id)).toEqual(
      expected.expectedFindings.map((entry) => entry.id),
    );
    for (const expectedFinding of expected.expectedFindings) {
      const actual = reviewPack.findings.find((finding) => finding.ground_truth_id === expectedFinding.id);
      expect(actual?.finding_type).toBe(expectedFinding.finding_type);
    }
    expect(reviewPack.metrics.recall).toBe(1);
    expect(reviewPack.metrics.falsePositives).toBe(0);
  });

  it('loads the Object A / June 2025 disk-backed fixture package from the default repo path', () => {
    const fixture = loadKsReconciliationFixturePackage();

    expect(fixture.scenario).toEqual({
      project: 'Object A',
      period: '2025-06',
      currency: 'RUB',
    });
    expect(fixture.documents.ks2.fileName).toBe('ks2_sample.pdf');
    expect(fixture.documents.ks2.sha256).toBe(fileSha256('ks2_sample.pdf'));
    expect(fixture.documents.ks2.content.rows).toHaveLength(12);
    expect(fixture.documents.ks3.fileName).toBe('ks3_sample.pdf');
    expect(fixture.documents.contract.fileName).toBe('contract_extract.xlsx');
    expect(fixture.documents.contract.sha256).toBe(fileSha256('contract_extract.xlsx'));
    expect(fixture.documents.contract.content.rows).toHaveLength(15);
    expect(fixture.documents.odataV4.content.value).toHaveLength(18);
    expect(fixture.documents.odataV3.content.d.results).toEqual(fixture.documents.odataV4.content.value);
    expect(fixture.expectedFindings.map((finding) => finding.id)).toEqual(['D-01', 'D-02', 'D-03', 'D-04', 'D-05']);
  });

  it('supports an explicit local fixture directory override and remains deterministic', () => {
    const reviewPackA = buildKsReconciliationReviewPack('run-ks-1', { fixturePath: FIXTURE_DIR });
    const reviewPackB = buildKsReconciliationReviewPack('run-ks-1', { fixturePath: 'fixtures/reconciliation-mvp' });

    expect(reviewPackA).toEqual(reviewPackB);
    expect(reviewPackA.sourceDocuments.map((document) => document.fileName)).toEqual([
      'ks2_sample.pdf',
      'ks3_sample.pdf',
      'contract_extract.xlsx',
      'odata_snapshot_v4.json',
      'odata_snapshot_v3.json',
    ]);
  });

  it('rejects KS-2 fixture rows with non-numeric required values', () => {
    const fixtureDir = createFixtureOverride({
      'ks2_sample.pdf': [
        '%PDF-1.4',
        '2 0 obj',
        '<< /Length 64 >>',
        'stream',
        '%PYRFOR_PAGE:1',
        '%PYRFOR_LINE:KS2|documentId|ks2-object-a-june-2025',
        '%PYRFOR_LINE:KS2|row|oops|1|Concrete stair march|m3|80|400000',
        '%PYRFOR_LINE:KS2|row|2|2|Concrete slab B|m3|45|540000',
        '%PYRFOR_LINE:KS2|row|3|3|Rebar bundle A|t|18|360000',
        '%PYRFOR_LINE:KS2|row|4|4|Formwork section 2|m2|210|280000',
        '%PYRFOR_LINE:KS2|row|5|5|Facade panel|m3|95|650000',
        '%PYRFOR_LINE:KS2|row|6|6|Roof membrane|m2|520|520000',
        '%PYRFOR_LINE:KS2|row|7|7|Pipe section 20-40|m|120|360000',
        '%PYRFOR_LINE:KS2|row|8|8|Cable 3x2.5|m|900|280000',
        '%PYRFOR_LINE:KS2|row|9|9|Lighting fixture LED|pcs|60|180000',
        '%PYRFOR_LINE:KS2|row|10|10|Ventilation duct|m|260|300000',
        '%PYRFOR_LINE:KS2|row|11|11|Ceramic tile|m2|340|460000',
        '%PYRFOR_LINE:KS2|row|12|12|Primer coat|m2|150|590000',
        '%PYRFOR_LINE:KS2|total|4920000',
        'endstream',
        'endobj',
        '',
      ].join('\n'),
    });

    expect(() => loadKsReconciliationFixturePackage({ fixturePath: fixtureDir }))
      .toThrow('KS-2 row number must be a strict numeric token');
  });

  it('rejects KS-3 fixture rows with non-numeric summary amounts', () => {
    const fixtureDir = createFixtureOverride({
      'ks3_sample.pdf': [
        '%PDF-1.4',
        '2 0 obj',
        '<< /Length 64 >>',
        'stream',
        '%PYRFOR_PAGE:1',
        '%PYRFOR_LINE:KS3|documentId|ks3-object-a-june-2025',
        '%PYRFOR_LINE:KS3|row|1|SMR works|oops',
        '%PYRFOR_LINE:KS3|row|2|Customer materials|520000',
        '%PYRFOR_LINE:KS3|row|3|Other costs|380000',
        '%PYRFOR_LINE:KS3|signedAt|2025-07-03',
        '%PYRFOR_LINE:KS3|total|4850000',
        'endstream',
        'endobj',
        '',
      ].join('\n'),
    });

    expect(() => loadKsReconciliationFixturePackage({ fixturePath: fixtureDir }))
      .toThrow('KS-3 amount must be a strict numeric token');
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
