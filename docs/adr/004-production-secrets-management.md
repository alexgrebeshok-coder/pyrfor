# ADR 004: Production Secrets Management

**Date:** 2026-04-23
**Status:** Proposed

## Context

CEOClaw is deploying to Vercel (region `fra1`). All production secrets are
currently injected via `process.env` and stored in:

- **Vercel Project → Environment Variables** (Production / Preview / Dev).
- A handful of long-lived API keys live there: `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GIGACHAT_AUTH_KEY`, `TELEGRAM_BOT_TOKEN`,
  `DATABASE_URL`, `CRON_SECRET`, `JWT_SECRET`, etc.

This is a Stage-1 baseline. It is acceptable for the pilot but has
limitations we need to address before broader rollout:

1. **No rotation workflow** — rotating a key requires a manual edit in
   the Vercel dashboard followed by a redeploy.
2. **No per-workspace tenancy** — all workspaces share one `OPENAI_API_KEY`.
   The orchestration layer already supports per-agent BYO keys (see
   `app/api/orchestration/agents/[id]/keys/route.ts`), but those keys are
   stored in the Postgres `AgentApiKey` table as plaintext (encrypted at
   rest only at the DB level).
3. **No audit trail** — we can't answer "who accessed `OPENAI_API_KEY`
   on April 12 at 14:32?".
4. **No emergency revocation** — leaked keys can only be rotated, not
   instantly revoked from a central pane.

## Decision

Adopt a **two-tier strategy**:

### Tier 1 (now → end of pilot): Vercel env + envelope-encrypted DB

- Keep platform-level secrets (`DATABASE_URL`, `CRON_SECRET`,
  `JWT_SECRET`, master `*_API_KEY` fallbacks) in Vercel env vars.
- Encrypt per-agent / per-workspace API keys in the `AgentApiKey` table
  using AES-256-GCM with a `SECRETS_ENC_KEY` master key stored in Vercel
  env. Add `lib/secrets/envelope.ts` with `encrypt(plaintext)` and
  `decrypt(ciphertext)` helpers.
- Document rotation runbook: `docs/runbooks/rotate-api-key.md`.

**Why:** zero new infrastructure, removes plaintext-at-rest risk, ships
this week.

### Tier 2 (post-pilot, Q3): Centralised secret manager

Adopt **Doppler** (recommended) or **HashiCorp Vault** depending on
self-host requirements:

| Criterion              | Doppler                    | Vault                         |
|------------------------|----------------------------|-------------------------------|
| Setup time             | ~1 hour                    | ~1 week (self-hosted)         |
| Vercel integration     | First-class (sync on deploy)| Manual via env-injection      |
| Per-env scoping        | Built-in                   | Built-in                      |
| Audit log              | Built-in (90 day default)  | Built-in (configurable)       |
| Cost                   | Free <5 users, then $7/seat| Free OSS / $$$ enterprise     |
| RU data residency      | ❌ US/EU                   | ✅ self-host                  |
| Secret rotation API    | ✅                         | ✅ + dynamic secrets          |

**Recommendation:** start with **Doppler** for SaaS-style velocity. If a
future RU-customer requires data residency, migrate to Vault on a
domestic VM. Doppler→Vault migration is a one-shot CSV/JSON re-import.

### Out of scope

- Customer-supplied "bring your own key" (BYOK) for LLM providers — the
  per-agent `AgentApiKey` table already covers this; Tier 1 envelope
  encryption is sufficient.
- Hardware HSM — overkill for current threat model.

## Consequences

**Positive:**

- Tier 1 closes the immediate plaintext-at-rest gap with zero new
  vendors.
- Tier 2 gives us audit, rotation, and per-env scoping without locking
  us into a single vendor (Doppler→Vault path is clean).

**Negative:**

- Tier 1 master key (`SECRETS_ENC_KEY`) becomes a single point of
  compromise. Mitigation: store in Vercel env (already production-hardened),
  rotate yearly, log every decrypt call to `SecretsAccessLog`.
- Tier 2 adds a deploy-time dependency; first failed Doppler sync would
  block a release. Mitigation: cache last-known secrets in CI artifact.

## Migration plan

1. **Week 1:** ship `lib/secrets/envelope.ts`, migrate
   `AgentApiKey.encryptedKey` column, write rotation runbook.
2. **Week 2:** add `SecretsAccessLog` Prisma model + audit middleware.
3. **Post-pilot:** evaluate Doppler vs Vault with the team, pilot the
   chosen tool against the staging environment, then production.

## References

- Existing per-agent key storage: `app/api/orchestration/agents/[id]/keys/route.ts`
- Vercel env docs: https://vercel.com/docs/environment-variables
- Doppler Vercel integration: https://docs.doppler.com/docs/vercel
- HashiCorp Vault Quick Start: https://developer.hashicorp.com/vault/tutorials
