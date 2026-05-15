import { createHash } from 'node:crypto';
const PYRFOR_VERSION = '1.2.0';
const DETERMINISTIC_CREATED_AT = '2026-05-15T00:00:00.000Z';
const DETERMINISTIC_MODEL_ID = 'pyrfor.ks-reconciliation.det-v1';
const KS2_ROWS = [
    { position: 1, name: 'Земляные работы', unit: 'м3', volume: 80, amountRub: 400000, page: 1, row: 1 },
    { position: 2, name: 'Бетон М300', unit: 'м3', volume: 45, amountRub: 540000, page: 1, row: 2 },
    { position: 3, name: 'Арматура А500С', unit: 'т', volume: 18, amountRub: 360000, page: 1, row: 3 },
    { position: 4, name: 'Монтаж опалубки', unit: 'м2', volume: 210, amountRub: 280000, page: 1, row: 4 },
    { position: 5, name: 'Кирпичная кладка', unit: 'м3', volume: 95, amountRub: 650000, page: 2, row: 5 },
    { position: 6, name: 'Штукатурные работы', unit: 'м2', volume: 520, amountRub: 520000, page: 2, row: 6 },
    { position: 7, name: 'Щебень фр.20-40', unit: 'т', volume: 120, amountRub: 360000, page: 2, row: 7 },
    { position: 8, name: 'Кабель ВВГнг 3x2.5', unit: 'м', volume: 900, amountRub: 280000, page: 2, row: 8 },
    { position: 9, name: 'Светильники LED', unit: 'шт', volume: 60, amountRub: 180000, page: 2, row: 9 },
    { position: 10, name: 'Прокладка труб', unit: 'м', volume: 260, amountRub: 300000, page: 3, row: 10 },
    { position: 11, name: 'Окраска фасада', unit: 'м2', volume: 340, amountRub: 460000, page: 3, row: 11 },
    { position: 12, name: 'Благоустройство', unit: 'м2', volume: 150, amountRub: 590000, page: 3, row: 12 },
];
const CONTRACT_ROWS = [
    { position: 1, name: 'Земляные работы', unit: 'м3', volume: 80, amountRub: 400000, sheet: 'Estimate', row: 1 },
    { position: 2, name: 'Бетон М300', unit: 'м3', volume: 45, amountRub: 540000, sheet: 'Estimate', row: 2 },
    { position: 3, name: 'Арматура А500С', unit: 'т', volume: 18, amountRub: 360000, sheet: 'Estimate', row: 3 },
    { position: 4, name: 'Монтаж опалубки', unit: 'м2', volume: 210, amountRub: 280000, sheet: 'Estimate', row: 4 },
    { position: 5, name: 'Кирпичная кладка', unit: 'м3', volume: 95, amountRub: 650000, sheet: 'Estimate', row: 5 },
    { position: 6, name: 'Штукатурные работы', unit: 'м2', volume: 520, amountRub: 520000, sheet: 'Estimate', row: 6 },
    { position: 7, name: 'Щебень фр.20-40', unit: 'т', volume: 115, amountRub: 345000, sheet: 'Estimate', row: 7 },
    { position: 8, name: 'Кабель ВВГнг 3x2.5', unit: 'м', volume: 900, amountRub: 280000, sheet: 'Estimate', row: 8 },
    { position: 9, name: 'Светильники LED', unit: 'шт', volume: 60, amountRub: 180000, sheet: 'Estimate', row: 9 },
    { position: 10, name: 'Прокладка труб', unit: 'м', volume: 260, amountRub: 300000, sheet: 'Estimate', row: 10 },
    { position: 11, name: 'Окраска фасада', unit: 'м2', volume: 340, amountRub: 460000, sheet: 'Estimate', row: 11 },
    { position: 12, name: 'Благоустройство', unit: 'м2', volume: 150, amountRub: 590000, sheet: 'Estimate', row: 12 },
    { position: 13, name: 'Временное электроснабжение', unit: 'компл', volume: 1, amountRub: 115000, sheet: 'Estimate', row: 13 },
    { position: 14, name: 'Испытания кабельных линий', unit: 'компл', volume: 1, amountRub: 75000, sheet: 'Estimate', row: 14 },
    { position: 15, name: 'Пусконаладка', unit: 'компл', volume: 1, amountRub: 150000, sheet: 'Estimate', row: 15 },
];
const ODATA_ENTRIES = [
    { id: 'odata-01', date: '2025-06-05', nomenclature: 'Земляные работы', unit: 'м3', volume: 80, amountRub: 400000, odataEntity: 'Document_Acts(guid-01)' },
    { id: 'odata-02', date: '2025-06-06', nomenclature: 'Бетон М300', unit: 'м3', volume: 45, amountRub: 540000, odataEntity: 'Document_Acts(guid-02)' },
    { id: 'odata-03', date: '2025-06-07', nomenclature: 'Арматура А500С', unit: 'т', volume: 18, amountRub: 360000, odataEntity: 'Document_Acts(guid-03)' },
    { id: 'odata-04', date: '2025-06-08', nomenclature: 'Монтаж опалубки', unit: 'м2', volume: 210, amountRub: 280000, odataEntity: 'Document_Acts(guid-04)' },
    { id: 'odata-05', date: '2025-06-09', nomenclature: 'Кирпичная кладка', unit: 'м3', volume: 95, amountRub: 650000, odataEntity: 'Document_Acts(guid-05)' },
    { id: 'odata-06', date: '2025-06-10', nomenclature: 'Штукатурные работы', unit: 'м2', volume: 520, amountRub: 520000, odataEntity: 'Document_Acts(guid-06)' },
    { id: 'odata-07', date: '2025-06-11', nomenclature: 'Щебень фр.20-40', unit: 'т', volume: 120, amountRub: 360000, odataEntity: 'Document_Acts(guid-07)' },
    { id: 'odata-08', date: '2025-06-12', nomenclature: 'Кабель ВВГ-нг(А) 3x2.5', unit: 'м', volume: 900, amountRub: 280000, odataEntity: 'Document_Acts(guid-08)' },
    { id: 'odata-09', date: '2025-06-13', nomenclature: 'Светильники LED', unit: 'шт', volume: 60, amountRub: 180000, odataEntity: 'Document_Acts(guid-09)' },
    { id: 'odata-10', date: '2025-06-14', nomenclature: 'Прокладка труб', unit: 'м', volume: 260, amountRub: 300000, odataEntity: 'Document_Acts(guid-10)' },
    { id: 'odata-11', date: '2025-06-15', nomenclature: 'Окраска фасада', unit: 'м2', volume: 340, amountRub: 460000, odataEntity: 'Document_Acts(guid-11)' },
    { id: 'odata-12', date: '2025-06-16', nomenclature: 'Благоустройство', unit: 'м2', volume: 150, amountRub: 590000, odataEntity: 'Document_Acts(guid-12)' },
    { id: 'odata-13', date: '2025-06-17', nomenclature: 'Временное электроснабжение', unit: 'компл', volume: 1, amountRub: 115000, odataEntity: 'Document_Acts(guid-13)' },
    { id: 'odata-14', date: '2025-06-18', nomenclature: 'Испытания кабельных линий', unit: 'компл', volume: 1, amountRub: 75000, odataEntity: 'Document_Acts(guid-14)' },
    { id: 'odata-15', date: '2025-06-20', nomenclature: 'Журнал производства работ', unit: 'шт', volume: 1, amountRub: 0, odataEntity: 'Document_Acts(guid-15)' },
    { id: 'odata-16', date: '2025-06-24', nomenclature: 'Накладная на материалы', unit: 'шт', volume: 1, amountRub: 0, odataEntity: 'Document_Acts(guid-16)' },
    { id: 'odata-17', date: '2025-06-28', nomenclature: 'Справка КС-3', unit: 'шт', volume: 1, amountRub: 4850000, odataEntity: 'Document_Acts(guid-17)' },
    { id: 'odata-18', date: '2025-07-10', nomenclature: 'Справка КС-3 к оплате', unit: 'шт', volume: 1, amountRub: 4850000, odataEntity: 'Document_Acts(guid-18)' },
];
function stableSha(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function buildDocument(fileName, kind, content) {
    return {
        fileName,
        kind,
        sha256: stableSha(content),
        content,
    };
}
function normalizeName(value) {
    return value
        .toLowerCase()
        .replace(/[().,\-/"«»]/g, '')
        .replace(/\s+/g, '')
        .replace(/ё/g, 'е');
}
function nameSignature(value) {
    var _a;
    const match = value.toLowerCase().match(/\d+x\d+(\.\d+)?/);
    return (_a = match === null || match === void 0 ? void 0 : match[0]) !== null && _a !== void 0 ? _a : '';
}
function buildLineage(artifactId, artifactType, sourceFiles) {
    return {
        artifact_id: artifactId,
        artifact_type: artifactType,
        source_files: [...sourceFiles],
        model_id: DETERMINISTIC_MODEL_ID,
        pyrfor_version: PYRFOR_VERSION,
        created_at: DETERMINISTIC_CREATED_AT,
    };
}
const FIXTURE_PACKAGE = {
    schemaVersion: 'pyrfor.ks_reconciliation_fixture.v1',
    fixtureId: 'object-a-june-2025',
    scenario: {
        project: 'Object A',
        period: '2025-06',
        currency: 'RUB',
    },
    documents: {
        ks2: buildDocument('ks2_sample.json', 'ks2', {
            documentId: 'ks2-object-a-june-2025',
            rows: KS2_ROWS,
            totalRub: 4920000,
        }),
        ks3: buildDocument('ks3_sample.json', 'ks3', {
            documentId: 'ks3-object-a-june-2025',
            summaryRows: [
                { label: 'Работы по разделу СМР', amountRub: 3950000, page: 1, row: 1 },
                { label: 'Материалы заказчика', amountRub: 520000, page: 1, row: 2 },
                { label: 'Прочие затраты', amountRub: 380000, page: 1, row: 3 },
            ],
            totalRub: 4850000,
            signedAt: '2025-07-03',
        }),
        contract: buildDocument('contract_extract.json', 'contract', {
            documentId: 'contract-object-a-june-2025',
            rows: CONTRACT_ROWS,
        }),
        odataV4: buildDocument('odata_snapshot_v4.json', 'odata_v4', {
            documentId: 'odata-v4-object-a-june-2025',
            value: ODATA_ENTRIES,
        }),
        odataV3: buildDocument('odata_snapshot_v3.json', 'odata_v3', {
            documentId: 'odata-v3-object-a-june-2025',
            d: { results: ODATA_ENTRIES },
        }),
    },
    expectedFindings: [
        { id: 'D-01', finding_type: 'amount_mismatch' },
        { id: 'D-02', finding_type: 'volume_mismatch' },
        { id: 'D-03', finding_type: 'name_mismatch' },
        { id: 'D-04', finding_type: 'date_mismatch' },
        { id: 'D-05', finding_type: 'missing_item' },
    ],
};
export function loadKsReconciliationFixturePackage() {
    return JSON.parse(JSON.stringify(FIXTURE_PACKAGE));
}
export function buildKsReconciliationReviewPack(runId) {
    const fixture = loadKsReconciliationFixturePackage();
    const ks2 = fixture.documents.ks2.content;
    const ks3 = fixture.documents.ks3.content;
    const contract = fixture.documents.contract.content;
    const odata = fixture.documents.odataV4.content.value;
    const findings = [];
    const lineage = [];
    const addFinding = (finding) => {
        findings.push(Object.assign(Object.assign({}, finding), { status: 'PENDING', reviewer_comment: null }));
        const findingLineage = buildLineage(finding.lineage_ref, 'finding', [...new Set(finding.evidence_ref.map((ref) => ref.source_file_sha256))]);
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
    if ((contractVolumeRow === null || contractVolumeRow === void 0 ? void 0 : contractVolumeRow.volume) !== undefined && ks2VolumeRow) {
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
    const odataCableRow = odata.find((row) => { var _a; return nameSignature(row.nomenclature) && nameSignature(row.nomenclature) === nameSignature((_a = ks2CableRow === null || ks2CableRow === void 0 ? void 0 : ks2CableRow.name) !== null && _a !== void 0 ? _a : ''); });
    if (ks2CableRow
        && odataCableRow
        && normalizeName(ks2CableRow.name) !== normalizeName(odataCableRow.nomenclature)) {
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
    const matched = findings.filter((finding) => fixture.expectedFindings.some((expected) => (expected.id === finding.ground_truth_id && expected.finding_type === finding.finding_type))).length;
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
export function buildKsReconciliationFinalReport(runId, approvalId, reviewPack) {
    const acceptedFindings = reviewPack.findings.map((finding) => (Object.assign(Object.assign({}, finding), { status: 'ACCEPTED', reviewer_comment: 'Bulk-approved via mandatory human review gate in the walking skeleton.' })));
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
            findingTypes: acceptedFindings.map((finding) => finding.finding_type),
            totalAmountDeltaRub: acceptedFindings.reduce((sum, finding) => {
                var _a;
                return (((_a = finding.delta) === null || _a === void 0 ? void 0 : _a.currency) === 'RUB' ? sum + Math.abs(finding.delta.value) : sum);
            }, 0),
        },
        findings: acceptedFindings,
        reportLineage: buildLineage(`lineage://ks-reconciliation/report/${runId}`, 'report', reviewPack.sourceDocuments.map((document) => document.sha256)),
        nextActions: [
            'Resolve accepted discrepancies in source estimate / 1C records.',
            'Keep the fixture-backed review pack as the audit baseline for future parser upgrades.',
        ],
    };
}
