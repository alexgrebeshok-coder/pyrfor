import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

export interface ProtoLineage {
  artifact_id: string;
  artifact_type: 'finding' | 'report' | 'extracted_table';
  source_files: string[];
  model_id: string;
  pyrfor_version: string;
  created_at: string;
}

export interface ReconciliationEvidenceRef {
  source_file_sha256: string;
  source_file_name: string;
  location: {
    page?: number;
    row?: number | string;
    cell?: string;
    odata_entity?: string;
  };
  extracted_text?: string;
}

export interface KsReconciliationFinding {
  finding_id: string;
  finding_type: 'amount_mismatch' | 'volume_mismatch' | 'name_mismatch' | 'date_mismatch' | 'missing_item';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  delta?: {
    value: number;
    currency?: string;
    unit?: string;
  };
  evidence_ref: ReconciliationEvidenceRef[];
  status: KsReconciliationFindingStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  reviewer_action: KsReconciliationFindingReviewAction | null;
  reviewer_comment: string | null;
  lineage_ref: string;
  ground_truth_id: 'D-01' | 'D-02' | 'D-03' | 'D-04' | 'D-05';
}

export type KsReconciliationFindingStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'ESCALATED';

export type KsReconciliationFindingReviewAction =
  | 'accept'
  | 'reject'
  | 'defer'
  | 'escalate';

export interface KsReconciliationFindingReviewRecord {
  finding_id: string;
  action: KsReconciliationFindingReviewAction;
  reviewer_id: string;
  reviewed_at: string;
  reviewer_comment: string | null;
}

interface Ks2Row {
  position: number;
  name: string;
  unit: string;
  volume: number;
  amountRub: number;
  page: number;
  row: number;
}

interface ContractRow {
  position: number;
  name: string;
  unit: string;
  volume?: number;
  amountRub: number;
  sheet: string;
  row: number;
}

interface OdataEntry {
  id: string;
  date: string;
  nomenclature: string;
  unit: string;
  volume?: number;
  amountRub: number;
  odataEntity: string;
}

interface FixtureDocument<T> {
  fileName: string;
  kind: 'ks2' | 'ks3' | 'contract' | 'odata_v4' | 'odata_v3';
  sha256: string;
  content: T;
}

export interface KsReconciliationFixturePackage {
  schemaVersion: 'pyrfor.ks_reconciliation_fixture.v1';
  fixtureId: 'object-a-june-2025';
  scenario: {
    project: 'Object A';
    period: '2025-06';
    currency: 'RUB';
  };
  documents: {
    ks2: FixtureDocument<{
      documentId: string;
      rows: Ks2Row[];
      totalRub: number;
    }>;
    ks3: FixtureDocument<{
      documentId: string;
      summaryRows: Array<{ label: string; amountRub: number; page: number; row: number }>;
      totalRub: number;
      signedAt: string;
    }>;
    contract: FixtureDocument<{
      documentId: string;
      rows: ContractRow[];
    }>;
    odataV4: FixtureDocument<{
      documentId: string;
      value: OdataEntry[];
    }>;
    odataV3: FixtureDocument<{
      documentId: string;
      d: { results: OdataEntry[] };
    }>;
  };
  expectedFindings: Array<{
    id: KsReconciliationFinding['ground_truth_id'];
    finding_type: KsReconciliationFinding['finding_type'];
  }>;
}

export interface KsReconciliationReviewPack {
  schemaVersion: 'pyrfor.ks_reconciliation_review_pack.v1';
  runId: string;
  fixtureId: string;
  generatedAt: string;
  reviewStatus: 'PENDING_HUMAN_REVIEW' | 'FINDINGS_REVIEWED';
  reviewMode: 'pack_approval';
  scenario: KsReconciliationFixturePackage['scenario'];
  sourceDocuments: Array<{
    fileName: string;
    kind: FixtureDocument<unknown>['kind'];
    sha256: string;
  }>;
  findings: KsReconciliationFinding[];
  reviewHistory: KsReconciliationFindingReviewRecord[];
  lineage: ProtoLineage[];
  approvalRequest: {
    toolName: 'ks_reconciliation_review_approval';
    summary: string;
  };
  metrics: {
    producedFindings: number;
    expectedFindings: number;
    precision: number;
    recall: number;
    falsePositives: number;
    evidenceCoverage: number;
  };
}

export interface KsReconciliationFinalReport {
  schemaVersion: 'pyrfor.ks_reconciliation_report.v1';
  runId: string;
  fixtureId: string;
  generatedAt: string;
  scenario: KsReconciliationFixturePackage['scenario'];
  approval: {
    approvalId: string;
    decision: 'approve';
    reviewMode: 'pack_approval';
  };
  summary: {
    findingsAccepted: number;
    findingsReviewed: number;
    reviewCounts: Record<Exclude<KsReconciliationFindingStatus, 'PENDING'>, number>;
    findingTypes: KsReconciliationFinding['finding_type'][];
    totalAmountDeltaRub: number;
  };
  findings: KsReconciliationFinding[];
  reportLineage: ProtoLineage;
  nextActions: string[];
}

export interface KsReconciliationFixtureLoadOptions {
  fixturePath?: string;
}

const PYRFOR_VERSION = '1.2.0';
const DETERMINISTIC_CREATED_AT = '2026-05-15T00:00:00.000Z';
const DETERMINISTIC_MODEL_ID = 'pyrfor.ks-reconciliation.det-v1';
const FIXTURE_SCHEMA_VERSION = 'pyrfor.ks_reconciliation_fixture.v1';
const DEFAULT_FIXTURE_DIRECTORY = path.join('fixtures', 'reconciliation-mvp');
const FIXTURE_FILES = {
  readme: 'README.md',
  ks2: 'ks2_sample.pdf',
  ks3: 'ks3_sample.pdf',
  contract: 'contract_extract.xlsx',
  odataV3: 'odata_snapshot_v3.json',
  odataV4: 'odata_snapshot_v4.json',
  expectedFindings: 'expected_findings.json',
} as const;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertFixture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`KS reconciliation fixture: ${message}`);
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildDocument<T>(
  fileName: string,
  kind: FixtureDocument<T>['kind'],
  sha256: string,
  content: T,
): FixtureDocument<T> {
  return {
    fileName,
    kind,
    sha256,
    content,
  };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[().,\-/"«»]/g, '')
    .replace(/\s+/g, '')
    .replace(/ё/g, 'е');
}

function nameSignature(value: string): string {
  const match = value.toLowerCase().match(/\d+x\d+(\.\d+)?/);
  return match?.[0] ?? '';
}

function buildLineage(
  artifactId: string,
  artifactType: ProtoLineage['artifact_type'],
  sourceFiles: string[],
): ProtoLineage {
  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    source_files: [...sourceFiles],
    model_id: DETERMINISTIC_MODEL_ID,
    pyrfor_version: PYRFOR_VERSION,
    created_at: DETERMINISTIC_CREATED_AT,
  };
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function findAncestorDirectory(relativePath: string): string | null {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(current, relativePath);
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findDefaultFixtureDirectory(): string | null {
  return findAncestorDirectory(DEFAULT_FIXTURE_DIRECTORY);
}

function resolveFixtureDirectory(fixturePath?: string): string {
  const trimmed = fixturePath?.trim();
  if (trimmed) {
    if (path.isAbsolute(trimmed)) return trimmed;
    const cwdResolved = path.resolve(process.cwd(), trimmed);
    return isDirectory(cwdResolved) ? cwdResolved : (findAncestorDirectory(trimmed) ?? cwdResolved);
  }
  return findDefaultFixtureDirectory()
    ?? path.resolve(process.cwd(), DEFAULT_FIXTURE_DIRECTORY);
}

function readFixtureFile(fixtureDir: string, fileName: string): Buffer {
  const filePath = path.join(fixtureDir, fileName);
  assertFixture(fs.existsSync(filePath), `missing required file ${fileName} in ${fixtureDir}`);
  return fs.readFileSync(filePath);
}

function parseStrictNumber(value: string | number | undefined | null, context: string): number {
  const normalized = `${value ?? ''}`.trim();
  assertFixture(/^-?\d+(\.\d+)?$/.test(normalized), `${context} must be a strict numeric token`);
  const parsed = Number(normalized);
  assertFixture(Number.isFinite(parsed), `${context} must be finite`);
  return parsed;
}

function decodePdfString(value: string): string {
  return value
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function extractFixturePdfPages(buffer: Buffer): Array<{ page: number; lines: string[] }> {
  const raw = buffer.toString('utf-8');
  const pages: Array<{ page: number; lines: string[] }> = [];
  const blockPattern = /%PYRFOR_PAGE:(\d+)\n([\s\S]*?)(?=%PYRFOR_PAGE:|endstream)/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockPattern.exec(raw)) !== null) {
    const page = Number.parseInt(blockMatch[1] ?? '', 10);
    assertFixture(Number.isFinite(page), 'invalid page marker in PDF fixture');
    const commentLines = blockMatch[2]
      .split(/\r?\n/g)
      .filter((line) => line.startsWith('%PYRFOR_LINE:'))
      .map((line) => line.slice('%PYRFOR_LINE:'.length).trim())
      .filter((line) => line.length > 0);
    const lines = commentLines.length > 0
      ? commentLines
      : [...blockMatch[2].matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
        .map((match) => decodePdfString(match[1] ?? '').trim())
        .filter((line) => line.length > 0);
    pages.push({ page, lines });
  }
  assertFixture(pages.length > 0, 'PDF fixture does not contain parsable PYRFOR page markers');
  return pages.sort((left, right) => left.page - right.page);
}

function parseKs2Pdf(fileName: string, buffer: Buffer): FixtureDocument<{
  documentId: string;
  rows: Ks2Row[];
  totalRub: number;
}> {
  const rows: Ks2Row[] = [];
  let documentId = '';
  let totalRub: number | null = null;

  for (const page of extractFixturePdfPages(buffer)) {
    for (const line of page.lines) {
      const parts = line.split('|');
      if (parts[0] !== 'KS2') continue;
      if (parts[1] === 'documentId') {
        documentId = parts[2] ?? documentId;
        continue;
      }
      if (parts[1] === 'row') {
        assertFixture(parts.length >= 8, `invalid KS-2 row format in ${fileName}`);
        rows.push({
          row: parseStrictNumber(parts[2], `${fileName} KS-2 row number`),
          position: parseStrictNumber(parts[3], `${fileName} KS-2 position`),
          name: parts[4] ?? '',
          unit: parts[5] ?? '',
          volume: parseStrictNumber(parts[6], `${fileName} KS-2 volume`),
          amountRub: parseStrictNumber(parts[7], `${fileName} KS-2 amount`),
          page: page.page,
        });
        continue;
      }
      if (parts[1] === 'total') {
        totalRub = parseStrictNumber(parts[2], `${fileName} KS-2 total`);
      }
    }
  }

  assertFixture(documentId.length > 0, `${fileName} is missing documentId`);
  assertFixture(rows.length === 12, `${fileName} must contain 12 KS-2 rows`);
  assertFixture(totalRub !== null && Number.isFinite(totalRub), `${fileName} is missing a valid total`);
  return buildDocument(fileName, 'ks2', sha256Buffer(buffer), {
    documentId,
    rows,
    totalRub,
  });
}

function parseKs3Pdf(fileName: string, buffer: Buffer): FixtureDocument<{
  documentId: string;
  summaryRows: Array<{ label: string; amountRub: number; page: number; row: number }>;
  totalRub: number;
  signedAt: string;
}> {
  const summaryRows: Array<{ label: string; amountRub: number; page: number; row: number }> = [];
  let documentId = '';
  let totalRub: number | null = null;
  let signedAt = '';

  for (const page of extractFixturePdfPages(buffer)) {
    for (const line of page.lines) {
      const parts = line.split('|');
      if (parts[0] !== 'KS3') continue;
      if (parts[1] === 'documentId') {
        documentId = parts[2] ?? documentId;
        continue;
      }
      if (parts[1] === 'row') {
        assertFixture(parts.length >= 5, `invalid KS-3 row format in ${fileName}`);
        summaryRows.push({
          row: parseStrictNumber(parts[2], `${fileName} KS-3 row number`),
          label: parts[3] ?? '',
          amountRub: parseStrictNumber(parts[4], `${fileName} KS-3 amount`),
          page: page.page,
        });
        continue;
      }
      if (parts[1] === 'signedAt') {
        signedAt = parts[2] ?? signedAt;
        continue;
      }
      if (parts[1] === 'total') {
        totalRub = parseStrictNumber(parts[2], `${fileName} KS-3 total`);
      }
    }
  }

  assertFixture(documentId.length > 0, `${fileName} is missing documentId`);
  assertFixture(summaryRows.length === 3, `${fileName} must contain 3 KS-3 summary rows`);
  assertFixture(totalRub !== null && Number.isFinite(totalRub), `${fileName} is missing a valid total`);
  assertFixture(/^\d{4}-\d{2}-\d{2}$/.test(signedAt), `${fileName} is missing signedAt`);
  return buildDocument(fileName, 'ks3', sha256Buffer(buffer), {
    documentId,
    summaryRows,
    totalRub,
    signedAt,
  });
}

function parseContractWorkbook(fileName: string, buffer: Buffer): FixtureDocument<{
  documentId: string;
  rows: ContractRow[];
}> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const estimateSheet = workbook.Sheets.Estimate;
  assertFixture(estimateSheet, `${fileName} must contain an Estimate sheet`);
  const estimateRows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(estimateSheet, {
    header: 1,
    raw: true,
  });
  assertFixture(estimateRows.length >= 16, `${fileName} must contain a header and 15 data rows`);
  const rows = estimateRows.slice(1).filter((row) => row.some((cell) => cell !== undefined && `${cell}`.trim().length > 0)).map((row, index) => ({
    position: parseStrictNumber(row[0], `${fileName} contract position`),
    name: `${row[1] ?? ''}`,
    unit: `${row[2] ?? ''}`,
    volume: row[3] === undefined || row[3] === null || `${row[3]}`.trim() === '' ? undefined : parseStrictNumber(row[3], `${fileName} contract volume`),
    amountRub: parseStrictNumber(row[4], `${fileName} contract amount`),
    sheet: 'Estimate',
    row: row[5] === undefined ? index + 1 : parseStrictNumber(row[5], `${fileName} contract row`),
  }));
  assertFixture(rows.length === 15, `${fileName} must yield 15 contract rows`);
  return buildDocument(fileName, 'contract', sha256Buffer(buffer), {
    documentId: 'contract-object-a-june-2025',
    rows,
  });
}

function parseOdataV4(fileName: string, buffer: Buffer): FixtureDocument<{
  documentId: string;
  value: OdataEntry[];
}> {
  const content = JSON.parse(buffer.toString('utf-8')) as { documentId?: string; value?: OdataEntry[] };
  assertFixture(typeof content.documentId === 'string' && content.documentId.length > 0, `${fileName} is missing documentId`);
  assertFixture(Array.isArray(content.value), `${fileName} must contain value[]`);
  assertFixture(content.value.length === 18, `${fileName} must contain 18 OData entries`);
  return buildDocument(fileName, 'odata_v4', sha256Buffer(buffer), {
    documentId: content.documentId as string,
    value: deepClone(content.value),
  });
}

function parseOdataV3(fileName: string, buffer: Buffer): FixtureDocument<{
  documentId: string;
  d: { results: OdataEntry[] };
}> {
  const content = JSON.parse(buffer.toString('utf-8')) as { documentId?: string; d?: { results?: OdataEntry[] } };
  assertFixture(typeof content.documentId === 'string' && content.documentId.length > 0, `${fileName} is missing documentId`);
  assertFixture(Array.isArray(content.d?.results), `${fileName} must contain d.results[]`);
  assertFixture((content.d?.results?.length ?? 0) === 18, `${fileName} must contain 18 OData entries`);
  return buildDocument(fileName, 'odata_v3', sha256Buffer(buffer), {
    documentId: content.documentId as string,
    d: { results: deepClone(content.d?.results ?? []) },
  });
}

function parseExpectedFindings(buffer: Buffer): KsReconciliationFixturePackage['expectedFindings'] {
  const content = JSON.parse(buffer.toString('utf-8')) as {
    fixtureId?: string;
    expectedFindings?: Array<{ id?: string; finding_type?: string }>;
  };
  assertFixture(content.fixtureId === 'object-a-june-2025', 'expected_findings.json fixtureId must be object-a-june-2025');
  assertFixture(Array.isArray(content.expectedFindings), 'expected_findings.json must contain expectedFindings[]');
  const findings = content.expectedFindings.map((entry) => ({
    id: entry.id as KsReconciliationFinding['ground_truth_id'],
    finding_type: entry.finding_type as KsReconciliationFinding['finding_type'],
  }));
  assertFixture(findings.length === 5, 'expected_findings.json must contain exactly 5 expected findings');
  return findings;
}

export function loadKsReconciliationFixturePackage(options: KsReconciliationFixtureLoadOptions = {}): KsReconciliationFixturePackage {
  const fixtureDir = resolveFixtureDirectory(options.fixturePath);
  assertFixture(isDirectory(fixtureDir), `fixture directory does not exist: ${fixtureDir}`);

  const ks2Buffer = readFixtureFile(fixtureDir, FIXTURE_FILES.ks2);
  const ks3Buffer = readFixtureFile(fixtureDir, FIXTURE_FILES.ks3);
  const contractBuffer = readFixtureFile(fixtureDir, FIXTURE_FILES.contract);
  const odataV4Buffer = readFixtureFile(fixtureDir, FIXTURE_FILES.odataV4);
  const odataV3Buffer = readFixtureFile(fixtureDir, FIXTURE_FILES.odataV3);
  const expectedFindingsBuffer = readFixtureFile(fixtureDir, FIXTURE_FILES.expectedFindings);
  readFixtureFile(fixtureDir, FIXTURE_FILES.readme);

  const documents = {
    ks2: parseKs2Pdf(FIXTURE_FILES.ks2, ks2Buffer),
    ks3: parseKs3Pdf(FIXTURE_FILES.ks3, ks3Buffer),
    contract: parseContractWorkbook(FIXTURE_FILES.contract, contractBuffer),
    odataV4: parseOdataV4(FIXTURE_FILES.odataV4, odataV4Buffer),
    odataV3: parseOdataV3(FIXTURE_FILES.odataV3, odataV3Buffer),
  };

  assertFixture(
    JSON.stringify(documents.odataV3.content.d.results) === JSON.stringify(documents.odataV4.content.value),
    'OData v3 and v4 fixture snapshots must describe the same entries',
  );

  return deepClone({
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    fixtureId: 'object-a-june-2025',
    scenario: {
      project: 'Object A',
      period: '2025-06',
      currency: 'RUB',
    },
    documents,
    expectedFindings: parseExpectedFindings(expectedFindingsBuffer),
  });
}

export function buildKsReconciliationReviewPack(
  runId: string,
  options: KsReconciliationFixtureLoadOptions = {},
): KsReconciliationReviewPack {
  const fixture = loadKsReconciliationFixturePackage(options);
  const ks2 = fixture.documents.ks2.content;
  const ks3 = fixture.documents.ks3.content;
  const contract = fixture.documents.contract.content;
  const odata = fixture.documents.odataV4.content.value;

  const findings: KsReconciliationFinding[] = [];
  const lineage: ProtoLineage[] = [];
  const addFinding = (finding: Omit<KsReconciliationFinding, 'status' | 'reviewer_id' | 'reviewed_at' | 'reviewer_action' | 'reviewer_comment'>) => {
    findings.push({
      ...finding,
      status: 'PENDING',
      reviewer_id: null,
      reviewed_at: null,
      reviewer_action: null,
      reviewer_comment: null,
    });
    const findingLineage = buildLineage(
      finding.lineage_ref,
      'finding',
      [...new Set(finding.evidence_ref.map((ref) => ref.source_file_sha256))],
    );
    lineage.push(findingLineage);
  };

  const amountDelta = ks2.totalRub - ks3.totalRub;
  if (amountDelta !== 0) {
    addFinding({
      finding_id: 'F-001',
      ground_truth_id: 'D-01',
      finding_type: 'amount_mismatch',
      severity: 'HIGH',
      description: `Сумма позиций КС-2 (${ks2.totalRub.toLocaleString('ru-RU')} RUB) не совпадает с итогом КС-3 (${ks3.totalRub.toLocaleString('ru-RU')} RUB). Расхождение составляет ${amountDelta.toLocaleString('ru-RU')} RUB.`,
      delta: { value: amountDelta, currency: 'RUB' },
      evidence_ref: [
        {
          source_file_sha256: fixture.documents.ks2.sha256,
          source_file_name: fixture.documents.ks2.fileName,
          location: { page: 3, row: 13 },
          extracted_text: `Итого КС-2: ${ks2.totalRub} RUB`,
        },
        {
          source_file_sha256: fixture.documents.ks3.sha256,
          source_file_name: fixture.documents.ks3.fileName,
          location: { page: 1, row: 'total' },
          extracted_text: `Итого КС-3: ${ks3.totalRub} RUB`,
        },
      ],
      lineage_ref: 'lineage://ks-reconciliation/F-001',
    });
  }

  const contractVolumeRow = contract.rows.find((row) => row.position === 7);
  const ks2VolumeRow = ks2.rows.find((row) => row.position === 7);
  if (contractVolumeRow?.volume !== undefined && ks2VolumeRow) {
    const volumeDelta = ks2VolumeRow.volume - contractVolumeRow.volume;
    if (volumeDelta !== 0) {
      addFinding({
        finding_id: 'F-002',
        ground_truth_id: 'D-02',
        finding_type: 'volume_mismatch',
        severity: 'HIGH',
        description: `Позиция ${ks2VolumeRow.position} "${ks2VolumeRow.name}" в КС-2 отражена как ${ks2VolumeRow.volume} ${ks2VolumeRow.unit}, а в договоре — ${contractVolumeRow.volume} ${contractVolumeRow.unit}. Перерасход составляет ${volumeDelta} ${ks2VolumeRow.unit}.`,
        delta: { value: volumeDelta, currency: 'RUB', unit: ks2VolumeRow.unit },
        evidence_ref: [
          {
            source_file_sha256: fixture.documents.ks2.sha256,
            source_file_name: fixture.documents.ks2.fileName,
            location: { page: ks2VolumeRow.page, row: ks2VolumeRow.row },
            extracted_text: `${ks2VolumeRow.name} — ${ks2VolumeRow.volume} ${ks2VolumeRow.unit}`,
          },
          {
            source_file_sha256: fixture.documents.contract.sha256,
            source_file_name: fixture.documents.contract.fileName,
            location: { row: contractVolumeRow.row, cell: 'C7' },
            extracted_text: `${contractVolumeRow.name} — ${contractVolumeRow.volume} ${contractVolumeRow.unit}`,
          },
        ],
        lineage_ref: 'lineage://ks-reconciliation/F-002',
      });
    }
  }

  const ks2CableRow = ks2.rows.find((row) => row.position === 8);
  const odataCableRow = odata.find((row) => nameSignature(row.nomenclature) && nameSignature(row.nomenclature) === nameSignature(ks2CableRow?.name ?? ''));
  if (
    ks2CableRow
    && odataCableRow
    && normalizeName(ks2CableRow.name) !== normalizeName(odataCableRow.nomenclature)
  ) {
    addFinding({
      finding_id: 'F-003',
      ground_truth_id: 'D-03',
      finding_type: 'name_mismatch',
      severity: 'MEDIUM',
      description: `Наименование "${ks2CableRow.name}" в КС-2 потенциально соответствует позиции 1C "${odataCableRow.nomenclature}", но классификация различается и требует ручной проверки.`,
      evidence_ref: [
        {
          source_file_sha256: fixture.documents.ks2.sha256,
          source_file_name: fixture.documents.ks2.fileName,
          location: { page: ks2CableRow.page, row: ks2CableRow.row },
          extracted_text: ks2CableRow.name,
        },
        {
          source_file_sha256: fixture.documents.odataV4.sha256,
          source_file_name: fixture.documents.odataV4.fileName,
          location: { odata_entity: odataCableRow.odataEntity },
          extracted_text: odataCableRow.nomenclature,
        },
      ],
      lineage_ref: 'lineage://ks-reconciliation/F-003',
    });
  }

  const latestOdataDate = [...odata].map((entry) => entry.date).sort().at(-1);
  if (latestOdataDate) {
    const deltaDays = Math.round((Date.parse(latestOdataDate) - Date.parse(ks3.signedAt)) / (24 * 60 * 60 * 1000));
    if (deltaDays !== 0) {
      addFinding({
        finding_id: 'F-004',
        ground_truth_id: 'D-04',
        finding_type: 'date_mismatch',
        severity: 'MEDIUM',
        description: `Дата подписания КС-3 (${ks3.signedAt}) отличается от последней связанной даты документа 1C (${latestOdataDate}) на ${deltaDays} дней.`,
        delta: { value: deltaDays, unit: 'days' },
        evidence_ref: [
          {
            source_file_sha256: fixture.documents.ks3.sha256,
            source_file_name: fixture.documents.ks3.fileName,
            location: { page: 1, row: 'signedAt' },
            extracted_text: `Подписано: ${ks3.signedAt}`,
          },
          {
            source_file_sha256: fixture.documents.odataV4.sha256,
            source_file_name: fixture.documents.odataV4.fileName,
            location: { odata_entity: 'Document_Acts(guid-18)' },
            extracted_text: `Дата 1C: ${latestOdataDate}`,
          },
        ],
        lineage_ref: 'lineage://ks-reconciliation/F-004',
      });
    }
  }

  const missingContractRow = contract.rows.find((row) => {
    const missingInKs2 = !ks2.rows.some((ks2Row) => normalizeName(ks2Row.name) === normalizeName(row.name));
    const missingInOdata = !odata.some((odataRow) => normalizeName(odataRow.nomenclature) === normalizeName(row.name));
    return missingInKs2 && missingInOdata;
  });
  if (missingContractRow) {
    addFinding({
      finding_id: 'F-005',
      ground_truth_id: 'D-05',
      finding_type: 'missing_item',
      severity: 'HIGH',
      description: `Договорная позиция "${missingContractRow.name}" на ${missingContractRow.amountRub.toLocaleString('ru-RU')} RUB отсутствует в КС-2 и снимке 1C.`,
      delta: { value: missingContractRow.amountRub, currency: 'RUB' },
      evidence_ref: [
        {
          source_file_sha256: fixture.documents.contract.sha256,
          source_file_name: fixture.documents.contract.fileName,
          location: { row: missingContractRow.row, cell: 'B15' },
          extracted_text: `${missingContractRow.name} — ${missingContractRow.amountRub} RUB`,
        },
      ],
      lineage_ref: 'lineage://ks-reconciliation/F-005',
    });
  }

  const matched = findings.filter((finding) => fixture.expectedFindings.some((expected) => (
    expected.id === finding.ground_truth_id && expected.finding_type === finding.finding_type
  ))).length;
  const falsePositives = Math.max(findings.length - matched, 0);
  const precision = findings.length > 0 ? matched / findings.length : 0;
  const recall = fixture.expectedFindings.length > 0 ? matched / fixture.expectedFindings.length : 0;
  const evidenceCoverage = findings.length > 0
    ? findings.filter((finding) => finding.evidence_ref.length > 0).length / findings.length
    : 0;

  return {
    schemaVersion: 'pyrfor.ks_reconciliation_review_pack.v1',
    runId,
    fixtureId: fixture.fixtureId,
    generatedAt: DETERMINISTIC_CREATED_AT,
    reviewStatus: 'PENDING_HUMAN_REVIEW',
    reviewMode: 'pack_approval',
    scenario: fixture.scenario,
    sourceDocuments: Object.values(fixture.documents).map((document) => ({
      fileName: document.fileName,
      kind: document.kind,
      sha256: document.sha256,
    })),
    findings,
    reviewHistory: [],
    lineage,
    approvalRequest: {
      toolName: 'ks_reconciliation_review_approval',
      summary: `Approve reconciliation review pack for ${fixture.scenario.project} / ${fixture.scenario.period}`,
    },
    metrics: {
      producedFindings: findings.length,
      expectedFindings: fixture.expectedFindings.length,
      precision,
      recall,
      falsePositives,
      evidenceCoverage,
    },
  };
}

function findingStatusForAction(action: KsReconciliationFindingReviewAction): Exclude<KsReconciliationFindingStatus, 'PENDING'> {
  switch (action) {
    case 'accept':
      return 'ACCEPTED';
    case 'reject':
      return 'REJECTED';
    case 'defer':
      return 'DEFERRED';
    case 'escalate':
      return 'ESCALATED';
  }
}

export function reviewKsReconciliationFinding(
  reviewPack: KsReconciliationReviewPack,
  input: {
    findingId: string;
    action: KsReconciliationFindingReviewAction;
    reviewerId: string;
    reviewedAt: string;
    reviewerComment?: string | null;
  },
): KsReconciliationReviewPack {
  const reviewerId = input.reviewerId.trim();
  if (!reviewerId) throw new Error('KS reconciliation review requires reviewerId');
  const reviewerComment = input.reviewerComment?.trim() ?? '';
  if (input.action === 'reject' && reviewerComment.length === 0) {
    throw new Error('KS reconciliation reject action requires reviewerComment');
  }
  const findingIndex = reviewPack.findings.findIndex((finding) => finding.finding_id === input.findingId);
  if (findingIndex === -1) {
    throw new Error(`KS reconciliation finding not found: ${input.findingId}`);
  }
  const updatedFindings = reviewPack.findings.map((finding, index) => (
    index === findingIndex
      ? {
          ...finding,
          status: findingStatusForAction(input.action),
          reviewer_id: reviewerId,
          reviewed_at: input.reviewedAt,
          reviewer_action: input.action,
          reviewer_comment: reviewerComment || null,
        }
      : finding
  ));
  return {
    ...reviewPack,
    reviewStatus: updatedFindings.some((finding) => finding.status === 'PENDING')
      ? 'PENDING_HUMAN_REVIEW'
      : 'FINDINGS_REVIEWED',
    findings: updatedFindings,
    reviewHistory: [
      ...reviewPack.reviewHistory,
      {
        finding_id: input.findingId,
        action: input.action,
        reviewer_id: reviewerId,
        reviewed_at: input.reviewedAt,
        reviewer_comment: reviewerComment || null,
      },
    ],
  };
}

export function buildKsReconciliationFinalReport(
  runId: string,
  approvalId: string,
  reviewPack: KsReconciliationReviewPack,
): KsReconciliationFinalReport {
  const pendingFindings = reviewPack.findings.filter((finding) => finding.status === 'PENDING');
  if (pendingFindings.length > 0) {
    throw new Error(`KS reconciliation final report requires review for all findings; pending: ${pendingFindings.map((finding) => finding.finding_id).join(', ')}`);
  }
  const acceptedFindings = reviewPack.findings.filter((finding) => finding.status === 'ACCEPTED');
  const reviewCounts = reviewPack.findings.reduce<Record<Exclude<KsReconciliationFindingStatus, 'PENDING'>, number>>((counts, finding) => {
    if (finding.status !== 'PENDING') counts[finding.status] += 1;
    return counts;
  }, {
    ACCEPTED: 0,
    REJECTED: 0,
    DEFERRED: 0,
    ESCALATED: 0,
  });
  return {
    schemaVersion: 'pyrfor.ks_reconciliation_report.v1',
    runId,
    fixtureId: reviewPack.fixtureId,
    generatedAt: DETERMINISTIC_CREATED_AT,
    scenario: reviewPack.scenario,
    approval: {
      approvalId,
      decision: 'approve',
      reviewMode: 'pack_approval',
    },
    summary: {
      findingsAccepted: acceptedFindings.length,
      findingsReviewed: reviewPack.findings.length,
      reviewCounts,
      findingTypes: reviewPack.findings.map((finding) => finding.finding_type),
      totalAmountDeltaRub: acceptedFindings.reduce((sum, finding) => (
        finding.delta?.currency === 'RUB' ? sum + Math.abs(finding.delta.value) : sum
      ), 0),
    },
    findings: reviewPack.findings,
    reportLineage: buildLineage(
      `lineage://ks-reconciliation/report/${runId}`,
      'report',
      reviewPack.sourceDocuments.map((document) => document.sha256),
    ),
    nextActions: [
      'Resolve accepted discrepancies in source estimate / 1C records.',
      'Keep the fixture-backed review pack as the audit baseline for future parser upgrades.',
    ],
  };
}
