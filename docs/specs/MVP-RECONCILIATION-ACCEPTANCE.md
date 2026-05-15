# MVP Reconciliation Acceptance Spec

**Version:** 1.2.0  
**Status:** Draft — execution target for Phase 0.0 / 0.1  
**Date:** 2026-05-15  
**Depends on:** `PYRFOR-ECOSYSTEM-VISION.md`, `PYRFOR-ECOSYSTEM-STRATEGY.md`

---

## 0. Purpose

This document defines when the first Pyrfor industrial wedge is shippable:

> Docs/1C + КС-2/КС-3 + contract/estimate reconciliation with evidence links and mandatory human review.

Phase 0 is not complete when "an end-to-end flow exists". It is complete only when the fixture package, quality thresholds, air-gapped constraints, demo script, and human-review workflow below pass.

**Legal scope:** Phase 0 produces an analytical review pack. It does not create legally significant electronic documents and does not replace КЭП/ЭДО workflows.

---

## 1. Scope and Non-Goals

### 1.1 In scope

| Area | Requirement |
|------|-------------|
| Inputs | КС-2, КС-3, contract extract, 1C OData snapshot |
| Formats | PDF native, PDF scan via local OCR, XLSX, 1C OData v3/v4 JSON |
| Reconciliation | Amount, volume, name, date, missing-item discrepancies |
| Evidence | Every finding links to source file hash and document location |
| Review | Reviewer must accept/reject/defer/escalate every finding |
| Lineage | Proto-lineage in Phase 0.0; full Artifact Ledger lineage in Phase 0.1 |
| Air-gapped | Zero external network calls in air-gapped mode |

### 1.2 Out of scope for Phase 0

| Area | Decision |
|------|----------|
| Automatic document correction | Not supported |
| Live write-back to 1C | Not supported; snapshots only |
| Final legal approval | Not supported without КЭП integration |
| ГОСТ/СНиП compliance checking | Regulatory Evidence Block, later phase |
| BIM/IFC quantities | BIM/CDE Block, later phase |
| Multi-user sync/RBAC | Enterprise phase |
| Mobile field capture | Phase E after market validation |

---

## 2. Test Fixture Package

The repository must contain or generate a fully anonymized fixture package:

```text
fixtures/reconciliation-mvp/
├── README.md
├── ks2_sample.pdf
├── ks3_sample.pdf
├── contract_extract.xlsx
├── odata_snapshot_v3.json
├── odata_snapshot_v4.json
└── expected_findings.json
```

### 2.1 Fixture parameters

| Parameter | Value |
|-----------|-------|
| Project | "Object A" synthetic construction project |
| Period | June 2025 |
| Currency | RUB |
| КС-2 rows | 12 |
| КС-3 summary rows | 3 |
| Contract rows | 15 |
| 1C entries | 18 |

### 2.2 Ground truth discrepancies

| ID | Type | Ground truth | Expected finding |
|----|------|--------------|------------------|
| D-01 | Amount mismatch | КС-3 total = 4,850,000 RUB; КС-2 total = 4,920,000 RUB | Amount mismatch, delta = +70,000 RUB |
| D-02 | Volume mismatch | КС-2 position 7 = 120 t; contract = 115 t | Volume overrun: 5 t / 4.3% |
| D-03 | Name mismatch | КС-2: `Кабель ВВГнг 3x2.5`; 1C: `Кабель ВВГ-нг(А) 3x2.5` | Potential duplicate/reclassification |
| D-04 | Date mismatch | КС-3 signed at 2025-07-03; 1C document at 2025-07-10 | 1C date is 7 days later |
| D-05 | Missing item | Contract contains `Пусконаладка` for 150,000 RUB; missing from КС-2 and 1C | Contract item not reflected in execution docs |

Ground truth contains exactly 5 expected findings.

---

## 3. Supported Inputs

| Format | Minimum support | Phase 0 |
|--------|-----------------|---------|
| PDF native | PDF 1.4-2.0 with text layer | Required |
| PDF scan | 150-400 dpi, Cyrillic OCR, skew up to +/-3 degrees | Required |
| XLSX | Excel 2007+ / LibreOffice-compatible | Required |
| 1C OData v3 JSON | Snapshot with `d.results[]` | Required |
| 1C OData v4 JSON | Snapshot with `value[]` | Required |
| XLS binary | `.xls` | Later |
| DOC/DOCX | Word documents | Later |
| XML/FNS formalized formats | Structured exchange | Later |
| IFC/BCF | BIM | Later |

OCR must be local in air-gapped mode. External OCR services are not allowed for Phase 0 acceptance.

---

## 4. Acceptance Metrics

### 4.1 Finding quality

| Metric | Target |
|--------|--------|
| Precision | >= 0.80 |
| Recall | >= 0.80 |
| False positives | <= 20% of produced findings |
| Evidence coverage | 100% findings have at least one evidence reference |

For the 5-finding fixture: at least 4 true positives and at most 1 false positive.

### 4.2 Performance

| Metric | Target | Environment |
|--------|--------|-------------|
| End-to-end latency | <= 10 minutes | Apple M1, 16 GB RAM, local LLM/OCR |
| Per-document latency | <= 3 minutes | One PDF up to 20 pages |
| Peak RAM | <= 8 GB | Desktop remains responsive |
| Disk writes | Project directory only | No persistent output outside project workspace |

### 4.3 Air-gapped behavior

| Requirement | Acceptance check |
|-------------|------------------|
| External HTTP calls | 0 calls outside localhost |
| LLM inference | Local provider only (Ollama/LocalAI/GGUF profile) |
| OCR | Local OCR only |
| Telemetry | Local collector/store only; no upload |

---

## 5. Human Review Requirements

Pyrfor findings are proposals until a reviewer acts.

| Action | Status | Requirement |
|--------|--------|-------------|
| Accept | `ACCEPTED` | Reviewer confirms the discrepancy is real |
| Reject | `REJECTED` | Reviewer comment is required |
| Defer | `DEFERRED` | Additional data is needed |
| Escalate | `ESCALATED` | External owner/action is required |

The report cannot be exported as final while any finding remains `PENDING`.

Each reviewer action must be recorded:

```json
{
  "reviewer_action": {
    "finding_id": "F-001",
    "action": "ACCEPTED",
    "reviewer_id": "user_local_001",
    "timestamp": "2026-05-15T10:00:00Z",
    "comment": "Подтверждено: расхождение на 70 000 RUB реально"
  }
}
```

---

## 6. Lineage Requirements

### 6.1 Phase 0.0 — proto-lineage

```ts
interface ProtoLineage {
  artifact_id: string;
  artifact_type: 'finding' | 'report' | 'extracted_table';
  source_files: string[];       // SHA-256 hashes
  model_id: string;
  pyrfor_version: string;
  created_at: string;           // ISO 8601
}
```

### 6.2 Phase 0.1 — full lineage

```ts
interface FullLineage extends ProtoLineage {
  prompt_hash: string;
  skill_versions: Record<string, string>;
  block_version: string;
  tools_called: ToolCall[];
  ocr_engine: string;
  reviewer_actions: ReviewerAction[];
  output_hash: string;
  lineage_schema_version: '0.1';
}
```

Lineage is stored locally in the project Artifact Ledger and exported next to the review report as JSON.

---

## 7. Five-Step Demo Script

1. **Create project.** Open Pyrfor Desktop, create `Object A — KS Reconciliation`, verify the project directory and empty ledger exist.
2. **Import fixture package.** Select КС-2, КС-3, contract extract, and 1C snapshots; verify local OCR runs for scanned PDF and no external network calls occur.
3. **Run reconciliation.** Start Docs/1C + Estimate Reconciliation flow; wait <= 10 minutes; verify 4-6 findings appear and every finding has `evidence_ref`.
4. **Human review.** Accept D-01..D-05, reject any false positive with comment; verify no finding remains `PENDING`.
5. **Export report.** Export JSON + PDF; verify report hash is recorded and repeated run over same fixtures is deterministic.

---

## 8. Go / No-Go Checklist

### 8.1 Phase 0.0

| ID | Criterion |
|----|-----------|
| G-01 | Precision >= 0.80 on fixture package |
| G-02 | Recall >= 0.80 on fixture package |
| G-03 | 100% findings have evidence references |
| G-04 | End-to-end latency <= 10 minutes on Apple M1 / 16 GB |
| G-05 | 0 external network calls in air-gapped mode |
| G-06 | Accept/Reject human review works |
| G-07 | Proto-lineage is recorded for every artifact |
| G-08 | All persistent files are written under project directory |
| G-09 | PDF native, PDF scan, XLSX, 1C OData v4 are supported |
| G-10 | Five-step demo reproduces on a clean install |
| G-11 | Fixtures pass anonymization checks |

### 8.2 Phase 0.1 additions

| ID | Criterion |
|----|-----------|
| G-12 | Full lineage includes prompt hash, skill versions, tools, output hash |
| G-13 | 1C OData v3 snapshots are supported |
| G-14 | Pilot manual baseline is measured and documented |
| G-15 | Pyrfor reduces pilot review time by >= 30% versus baseline |
| G-16 | Package up to 50 line items processes in <= 10 minutes |
| G-17 | PDF report includes lineage footer |

---

## 9. Finding Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "PyrforReconciliationFinding",
  "type": "object",
  "required": [
    "finding_id",
    "finding_type",
    "severity",
    "description",
    "evidence_ref",
    "status",
    "lineage_ref"
  ],
  "properties": {
    "finding_id": {
      "type": "string",
      "pattern": "^F-[0-9]{3,}$"
    },
    "finding_type": {
      "type": "string",
      "enum": [
        "amount_mismatch",
        "volume_mismatch",
        "name_mismatch",
        "date_mismatch",
        "missing_item",
        "duplicate",
        "other"
      ]
    },
    "severity": {
      "type": "string",
      "enum": ["HIGH", "MEDIUM", "LOW"]
    },
    "description": {
      "type": "string"
    },
    "delta": {
      "type": "object",
      "properties": {
        "value": { "type": "number" },
        "currency": { "type": "string", "default": "RUB" },
        "unit": { "type": "string" }
      }
    },
    "evidence_ref": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["source_file_sha256", "location"],
        "properties": {
          "source_file_sha256": { "type": "string" },
          "source_file_name": { "type": "string" },
          "location": {
            "type": "object",
            "properties": {
              "page": { "type": "integer" },
              "row": { "type": ["integer", "string"] },
              "cell": { "type": "string" },
              "odata_entity": { "type": "string" }
            }
          },
          "extracted_text": {
            "type": "string",
            "maxLength": 200
          }
        }
      }
    },
    "status": {
      "type": "string",
      "enum": ["PENDING", "ACCEPTED", "REJECTED", "DEFERRED", "ESCALATED"]
    },
    "reviewer_comment": {
      "type": ["string", "null"]
    },
    "lineage_ref": {
      "type": "string"
    }
  }
}
```

### Example

```json
{
  "finding_id": "F-001",
  "finding_type": "amount_mismatch",
  "severity": "HIGH",
  "description": "Сумма итого в КС-3 (4 850 000 RUB) не соответствует сумме позиций КС-2 (4 920 000 RUB). Расхождение составляет 70 000 RUB.",
  "delta": {
    "value": -70000,
    "currency": "RUB"
  },
  "evidence_ref": [
    {
      "source_file_sha256": "a1b2c3d4...",
      "source_file_name": "ks2_sample.pdf",
      "location": { "page": 3, "row": "Итого" },
      "extracted_text": "Итого по акту: 4 920 000,00 руб."
    },
    {
      "source_file_sha256": "e5f6a7b8...",
      "source_file_name": "ks3_sample.pdf",
      "location": { "page": 1, "row": "Итого" },
      "extracted_text": "Итоговая стоимость: 4 850 000,00 руб."
    }
  ],
  "status": "PENDING",
  "reviewer_comment": null,
  "lineage_ref": "artifact-uuid-001"
}
```

---

## 10. Fixture Privacy

Fixtures must contain no real personal data, counterparty secrets, bank details, or real project addresses.

Minimum anonymization procedure:

1. Replace organization names with synthetic names.
2. Replace INN/KPP/OGRN, bank accounts, and addresses with synthetic values.
3. Replace any names of individuals with synthetic roles or names.
4. Shift dates into a synthetic period.
5. Scale monetary values with a non-round factor.
6. Run automatic regex/NER checks.
7. Record SHA-256 hashes in fixture `README.md`.

Real client documents must never be committed to the repository.

---

## 11. Pilot Baseline Measurement

Before using Pyrfor in a pilot, measure the manual process on the same package type.

| Metric | Unit | Measurement |
|--------|------|-------------|
| Manual review time | Minutes | Time 3+ manual sessions |
| Manual findings | Count | Findings found by reviewer |
| Missed findings | Count | Independent verification |
| Error rate | FN / (TP + FN) | Derived |
| Clarification iterations | Count | Number of returns to document/source |

Phase 0.1 target:

| Metric | Target |
|--------|--------|
| Review time | <= 70% of manual baseline |
| Error rate | <= 80% of manual baseline |

Baseline form:

```text
Measurement date:
Reviewer role:
Document package:
Manual review time:
Findings found manually:
Findings verified independently:
Missed findings:
Error rate:
Clarification iterations:
Verifier:
```

---

## 12. Related Documents

| Document | Relationship |
|----------|--------------|
| `BLOCK-MANIFEST-V1.md` | Docs/1C and Reconciliation blocks must be Manifest v1 packages |
| `RU-COMPLIANCE-SCOPE.md` | Legal scope, КЭП, 152-ФЗ, data residency |
| `PYRFOR-ECOSYSTEM-STRATEGY.md` | Roadmap and Phase 0/0.1 sequencing |
| `PYRFOR-ECOSYSTEM-VISION.md` | Product vision and block model |
