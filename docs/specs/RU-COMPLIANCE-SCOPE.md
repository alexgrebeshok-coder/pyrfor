# RU Compliance Scope

**Version:** 1.2.0-draft  
**Status:** Engineering scope — requires legal review before customer use  
**Date:** 2026-05-15  
**Depends on:** `PYRFOR-ECOSYSTEM-VISION.md`, `PYRFOR-ECOSYSTEM-STRATEGY.md`

---

## 0. Disclaimer

This document is an engineering specification, not legal advice.

It describes technical controls that Pyrfor may implement to reduce compliance risk for Russian on-prem / air-gapped construction deployments. It is not:

- a legal opinion on 152-ФЗ, 187-ФЗ, 63-ФЗ, or other laws;
- a FSTEC/FSB certification;
- proof of compliance for any specific organization;
- a substitute for deployment-specific legal and information-security review.

The organization deploying Pyrfor remains responsible for operator duties, ИСПДн classification, КИИ categorization, accredited electronic-signature workflows, and regulatory filings.

---

## 1. Scope

Pyrfor may process construction documents, 1C exports, КС-2/КС-3, contracts, estimates, regulatory findings, and approval evidence. For the Russian enterprise market, v1.2 must distinguish three scopes:

| Label | Meaning |
|-------|---------|
| `v1` | Community / core scope |
| `pro` | Commercial / enterprise scope |
| `operator` | Customer/operator responsibility |
| `out-of-scope` | Explicitly not provided by Pyrfor |

---

## 2. Compliance Matrix

| Area | Requirement | Pyrfor scope | Technical control |
|------|-------------|--------------|-------------------|
| 152-ФЗ personal data | Local processing, audit, erasure, processing purpose | `v1` for technical controls; operator duties remain `operator` | PDM + DRG |
| 152-ФЗ operator notification / policies | Organizational filings and policies | `operator` | CPD may provide templates in `pro` |
| 187-ФЗ КИИ | Categorization, certified controls, incident process | `operator`; deployment support in `pro` | CPD + DRG; Community v1 not for direct KII category 1/2 processing |
| 63-ФЗ electronic signature | Legally significant КЭП, TSP, CAdES | `pro` integration; legal workflow remains `operator` | GSM |
| ГОСТ Р 34.10/34.11 | ГОСТ signatures/hash for КЭП | `pro` | GSM via CryptoPro PKCS#11 |
| FSTEC/FSB certification | Certified OS/DB/security tools and assessment | `operator`; roadmap support in `pro` | CPD |
| Russian software registry | Минцифры register for госзакупки | `pro` / organizational | RP |
| Data residency for AI inference | Prevent foreign LLM egress for PII/KII/commercial secret | `v1` | DRG |
| ФЕР/ТЕР/ГЭСН/ФСНБ | Normative estimate data redistribution | `operator` / BYOD in v1 | BYOD data packs; FGIS CS research in Phase B |

### Explicit v1 limitations

1. Community v1 is not FSTEC/FSB certified.
2. Community v1 does not provide legally significant КЭП signing.
3. Community v1 is not intended for direct processing of КИИ category 1/2 data without customer-led certification and controls.
4. Community v1 does not redistribute ФЕР/ТЕР/ГЭСН/ФСНБ data.
5. Artifact Ledger is a technical audit trail, not an ЭДО/КЭП system.

---

## 3. Five Compliance Primitives

### 3.1 DRG — Data Residency Guard

**Purpose:** prevent personal data, КИИ context, and commercial secrets from being sent to foreign or unapproved model providers.

DRG sits in the LLM router before every provider call.

```text
Prompt / document context
  -> classifier
  -> residency mode resolver
  -> provider allow/deny decision
  -> audit event
```

Modes:

| Mode | Trigger | Allowed providers |
|------|---------|-------------------|
| `open` | No sensitive data detected | User-configured providers |
| `pii_mode` | Personal data detected | Local/on-prem and approved Russian providers only |
| `kii_mode` | КИИ flag or policy | Local/on-prem only |
| `commercial_secret` | Commercial secret marker or policy | Local/on-prem only by default |
| `air_gapped` | Deployment policy | Localhost/on-prem endpoints only |

Required audit event:

```json
{
  "event": "drg.provider_decision",
  "mode": "pii_mode",
  "provider_requested": "openai",
  "provider_selected": "ollama",
  "decision": "blocked_foreign_provider",
  "reason": "PII detected in prompt payload",
  "artifact_id": "art-...",
  "timestamp": "2026-05-15T10:00:00Z"
}
```

Scope:

| Edition | Scope |
|---------|-------|
| v1 | Basic classifier, allow/deny routing, local audit log |
| pro | Custom dictionaries, SIEM export, enterprise policy bundles |

### 3.2 GSM — GOST Signing Module

**Purpose:** integrate with Russian КЭП infrastructure for legally significant signatures when an enterprise deployment requires it.

GSM is not part of Community v1. It is a Pro/commercial module.

```text
Pyrfor artifact
  -> GSM adapter
  -> CryptoPro CSP via PKCS#11
  -> CAdES-BES / CAdES-T / CAdES-A
  -> signed document package
```

Operations:

| Operation | Scope | Meaning |
|-----------|-------|---------|
| `gsm.verify(document)` | pro | Verify incoming КЭП |
| `gsm.sign(artifact_id, certificate)` | pro | Sign output artifact |
| `gsm.timestamp(artifact_id)` | pro | Add TSP timestamp |
| `gsm.archive(artifact_id)` | pro | Create long-term CAdES-A package |
| Release dual-signing | pro | Ed25519 for OSS + ГОСТ signature for Russian enterprise release |

Constraints:

- Pyrfor should wrap certified providers such as CryptoPro; it should not implement its own unlicensed СКЗИ.
- Private keys must stay in customer-controlled certified storage.
- Legal force depends on the customer's accredited certificate, TSP, and ЭДО process.

### 3.3 PDM — Personal Data Management

**Purpose:** provide technical lifecycle controls for personal data handled inside Pyrfor.

Minimum data model:

```sql
CREATE TABLE pdm_subjects (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  data_fields TEXT NOT NULL,
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  consent_at TEXT,
  expires_at TEXT,
  erased_at TEXT,
  erased_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pdm_access_log (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES pdm_subjects(id),
  accessor TEXT NOT NULL,
  action TEXT NOT NULL,
  artifact_id TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Operations:

| Operation | Scope | Meaning |
|-----------|-------|---------|
| `pdm.register(subject)` | v1 | Register personal-data subject metadata |
| `pdm.record_consent(subject_id, purpose)` | v1 | Record consent/legal basis metadata |
| `pdm.erase(subject_id)` | v1 | Delete or anonymize subject data where technically possible |
| `pdm.export_subject(subject_id)` | v1 | Export known data for a subject |
| `pdm.audit_trail(subject_id)` | v1 | Show access log |
| ИСПДн documentation templates | pro | Operator templates for deployment documentation |

PDM is a technical feature. It does not replace operator obligations under 152-ФЗ.

### 3.4 CPD — Certified Platform Declaration

**Purpose:** provide a deployable enterprise profile for Russian regulated environments.

CPD is Pro/commercial scope.

Package contents:

```text
cpd-package/
├── deployment-guide-astra.md
├── deployment-guide-alt.md
├── postgres-pro-profile.md
├── hardening-checklist.md
├── ispdn-template-docs/
├── fstec-roadmap.md
└── dependency-licenses.txt
```

Target platforms:

| Platform | Scope |
|----------|-------|
| Astra Linux Special Edition | pro compatibility target |
| ALT Linux | pro compatibility target |
| Postgres Pro | pro enterprise backend option |
| CryptoPro CSP | via GSM |

CPD does not itself certify Pyrfor. It creates the technical and documentation package needed for customer assessment and future certification work.

### 3.5 RP — Registry Package

**Purpose:** prepare Pyrfor for the Russian software registry and B2G procurement path.

RP is Pro/organizational scope.

Package:

```text
rp-package/
├── sbom.cdx.json
├── third-party-licenses/
├── rospatent-application.md
├── mintsifra-checklist.md
├── support-process.md
└── legal-entity-structure.md
```

Requirements tracked:

| Requirement | Scope |
|-------------|-------|
| CycloneDX SBOM | v1 basic, pro complete |
| Russian legal entity | pro / organizational |
| IP rights registration | pro / organizational |
| Support process and SLA | pro |
| Минцифры registry application | pro / organizational |

---

## 4. Legal Weight of Artifact Ledger

Artifact Ledger is a technical audit trail.

| Aspect | Artifact Ledger | Legally significant ЭДО |
|--------|-----------------|--------------------------|
| Signature | Content hash / package signature | КЭП under 63-ФЗ |
| Timestamp | Local timestamp | Accredited TSP timestamp |
| Purpose | Lineage and internal audit | Legal document exchange |
| Storage | Local project database/export | Customer ЭДО/archive process |
| Legal force | Not guaranteed | Depends on КЭП, UЦ, TSP, ЭДО setup |

Required product language:

> Pyrfor records technical evidence and review lineage. It does not make a document legally signed unless GSM/КЭП integration and the customer's accredited ЭДО process are configured.

---

## 5. Estimate Normative Data Packs

Pyrfor v1 must use a **bring-your-own data** strategy for ФЕР/ТЕР/ГЭСН/ФСНБ.

| Data source | v1 strategy | Later strategy |
|-------------|-------------|----------------|
| ФСНБ / ФЕР / ГЭСН | User-provided data pack; no redistribution | Licensed redistribution only after agreement |
| ТЕР | User-provided regional data | Regional agreements if commercially justified |
| ФГИС ЦС | Research only | Phase B API integration if permitted |

Implementation rules:

1. Do not commit normative databases into the public repository.
2. Provide parsers/importers for user-owned XML/XLSX/CSV data.
3. Show a license warning before import.
4. Store source metadata: origin, version, region, import date, user confirmation.
5. Treat `lookup_rate(code)` as unavailable until a data pack is installed.

---

## 6. Recommended Risk Labels

| Risk | Level | Mitigation |
|------|-------|------------|
| `RISK-PDN-01` — operator duties under 152-ФЗ are unmet | High | PDM + legal checklist; state operator responsibility |
| `RISK-KII-01` — v1 used on КИИ without certification | High | Explicit v1 non-goal; CPD/pro path |
| `RISK-EP-01` — Artifact Ledger confused with КЭП | High | Legal-weight wording in UI/docs; GSM for Pro |
| `RISK-GOST-01` — Ed25519 treated as ГОСТ signature | Medium | Distinguish OSS signing from ГОСТ/КЭП |
| `RISK-REG-01` — B2G blocked by missing Минцифры registry | Medium | RP roadmap |
| `RISK-DATA-01` — unlicensed estimate databases imported/distributed | High | BYOD, no redistribution, import warning |
| `RISK-DRG-01` — foreign LLM called with sensitive data | High | DRG default policies and audit |

---

## 7. Cross-References

| This spec | Related document | Topic |
|-----------|------------------|-------|
| DRG | `PYRFOR-ECOSYSTEM-VISION.md` §1.1 / §5 | Safety by default and air-gapped SI |
| GSM | `PYRFOR-ECOSYSTEM-VISION.md` §2.4 | Artifact Ledger legal weight |
| BYOD data packs | `PYRFOR-ECOSYSTEM-STRATEGY.md` §5.1 | Estimate Block |
| CPD/RP | `PYRFOR-ECOSYSTEM-STRATEGY.md` §2.3 / §7 | SBOM, risks, enterprise |
| Manifest capabilities | `BLOCK-MANIFEST-V1.md` | `cloud-llm:invoke`, signing, capability tokens |

---

## 8. Sources

| Area | Source |
|------|--------|
| 152-ФЗ | https://www.consultant.ru/document/cons_doc_LAW_61801/ |
| 187-ФЗ | https://www.consultant.ru/document/cons_doc_LAW_220885/ |
| 63-ФЗ | https://www.consultant.ru/document/cons_doc_LAW_112701/ |
| ГОСТ Р 34.10-2012 | https://www.tc26.ru/standard/gost/GOST_R_34.10-2012.pdf |
| ГОСТ Р 34.11-2012 | https://www.tc26.ru/standard/gost/GOST_R_34.11-2012.pdf |
| ФСТЭК Приказ 21 | https://fstec.ru/component/attachments/download/565 |
| ФСТЭК Приказ 239 | https://fstec.ru/component/attachments/download/812 |
| Реестр ПО Минцифры | https://reestr.digital.gov.ru/ |
| ФГИС ЦС | https://fgiscs.minstroyrf.ru/ |
| CryptoPro CSP | https://www.cryptopro.ru/products/csp |
| CycloneDX | https://cyclonedx.org/ |

---

## 9. Next Steps

| Priority | Task |
|----------|------|
| P0 | Legal review of 152-ФЗ / 63-ФЗ wording |
| P0 | Implement DRG base classifier and provider-blocking policy |
| P0 | Implement PDM registry/access log/erasure operations |
| P1 | Add UI warnings for legal weight and estimate data-pack import |
| P1 | Generate CycloneDX SBOM in CI |
| P2 | Prototype GSM verify-only adapter via CryptoPro PKCS#11 |
| P2 | Research ФГИС ЦС API for Phase B |
