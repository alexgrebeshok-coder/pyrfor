# Reconciliation MVP fixture package

Synthetic local-only fixture package for the KS-2/KS-3 reconciliation walking skeleton.

## Contents

- `ks2_sample.pdf`: synthetic three-page native-text KS-2 fixture with 12 rows and total 4,920,000 RUB.
- `ks3_sample.pdf`: synthetic native-text KS-3 fixture with 3 summary rows, signed date 2025-07-03 and total 4,850,000 RUB.
- `contract_extract.xlsx`: synthetic contract/estimate extract with 15 rows on the `Estimate` sheet.
- `odata_snapshot_v3.json` and `odata_snapshot_v4.json`: local 1C snapshot variants with 18 entries.
- `expected_findings.json`: the five known deterministic discrepancies.

## Scenario

- Project: Object A
- Period: June 2025
- Currency: RUB

This package is intentionally minimal and deterministic. The PDFs and workbook are real files that the runtime reads from disk; the parser is fixture-specific and not intended as a general document ingestion pipeline.
