Agent completed. agent_id: arch-gpt55, agent_type: general-purpose, status: completed, description: GPT-5.5 universal engine architecture, elapsed: 332s, total_turns: 0, model: gpt-5.5, duration: 329s

# Pyrfor Universal Engine v1 — Architectural Proposal

## 0. Executive Position

Pyrfor Universal Engine v1 should become a governed autonomous delivery kernel, not “just another agent loop.”

Its job is to accept a user concept, convert it into an executable contract, ask only necessary clarifying questions, research the domain, synthesize a durable plan, discover or forge missing capabilities, execute in sandboxes, verify independently, self-heal failures, package evidence-backed deliverables, and write memory for future runs.

The architecture must extend the current Pyrfor runtime primitives:

- `RunLedger` remains the canonical lifecycle state.
- `EventLedger` remains the canonical audit log.
- `DurableDag` remains the canonical task graph.
- `ArtifactStore` remains the canonical artifact/evidence store.
- `VerifierLane` remains the independent verification lane.
- `ActorKernel` becomes the multi-agent substrate.
- `PermissionEngine`, `ToolRegistry`, `Guardrails`, and `approval-flow` become the safety and permission spine.
- `ContextCompiler` becomes the context/memory packaging spine.
- `gateway.ts` becomes the external control API.
- Existing FreeClaude/ACP worker bridges remain worker transports rather than being replaced.

The v1 design should avoid parallel orchestration stacks. Every new capability should surface as:

- a run,
- ledger events,
- DAG nodes,
- artifacts,
- actor messages,
- tool registry entries,
- verifier reports,
- and memory writes.

---

## 1. Refined Principles

### 1.1 Universal, But Contract-Driven

Pyrfor should handle many deliverable types, but every run must be reduced to an explicit contract.

A concept such as:

> “Build me a CRM for small law firms”

must become a structured `ConceptContract`:

- user intent,
- target deliverable type,
- success criteria,
- constraints,
- autonomy level,
- sandbox profile,
- allowed integrations,
- budget,
- required evidence,
- delivery format.

Universality comes from generic lifecycle machinery plus domain overlays, not from unbounded free-form execution.

### 1.2 Autonomy With Evidence

The engine may act autonomously only when it can produce evidence.

Every major decision should be justified by:

- source captures,
- tool provenance,
- generated tests,
- command logs,
- verifier output,
- artifacts,
- durable events.

No opaque “agent said it is done” state should be accepted.

### 1.3 Host-Owned Effects

Workers and agents propose effects.

The host owns effects.

This matches current architecture in:

- `worker-protocol.ts`
- `worker-protocol-bridge.ts`
- `contracts-bridge.ts`
- `two-phase-effect.ts`
- `orchestration-host-factory.ts`

Workers may emit:

- plan fragments,
- proposed patches,
- proposed commands,
- capability requests,
- artifact references,
- final reports.

But the host decides:

- permission,
- approval,
- execution,
- recording,
- rollback,
- verification.

### 1.4 Durable Orchestration Over Chat Loops

The primary runtime abstraction should not be a chat transcript.

The primary abstraction should be:

- `RunRecord` in `RunLedger`,
- `LedgerEvent` in `EventLedger`,
- task nodes in `DurableDag`,
- proof artifacts in `ArtifactStore`.

Chat is one interface.

Gateway, CLI, VS Code, scheduled jobs, product factory, and autonomous loops should all map to the same run substrate.

### 1.5 Independent Verification Is Mandatory

The executor cannot verify itself.

The `VerifierLane` must remain independent and should be extended to cover:

- task acceptance criteria,
- generated test suites,
- tool safety,
- artifact integrity,
- delivery packaging,
- memory writes,
- self-improvement proposals.

### 1.6 Self-Extension Is Gated

Tool creation is allowed, but promotion is not automatic.

A forged tool moves through trust tiers:

1. `draft`
2. `sandboxed`
3. `verified`
4. `trusted`
5. `deprecated`
6. `quarantined`

Promotion requires tests, provenance, policy checks, and verifier approval.

Human approval is required for tool promotion beyond the default autonomous tier.

### 1.7 Memory Is Typed

Memory should not be a generic blob store.

Pyrfor v1 should distinguish:

- episodic memory,
- semantic memory,
- strategic memory,
- procedural memory.

Each agent receives only the memory classes it needs.

### 1.8 Budget Is Architectural, Not Cosmetic

Token, model, and tool budgets must be declared per phase.

`TokenBudgetController` should become phase-aware:

- clarification budget,
- research budget,
- planning budget,
- forging budget,
- execution budget,
- verification budget,
- self-heal budget,
- packaging budget,
- postmortem budget.

### 1.9 Reuse Existing Primitives First

The architecture should extend files already present under:

`/packages/engine/src/runtime/`

Do not introduce competing systems for:

- run state,
- event logs,
- artifacts,
- DAG execution,
- approval,
- verification,
- tool permission,
- context packaging.

### 1.10 Explainability Is a Product Feature

Every run should be inspectable through:

- API,
- CLI,
- VS Code,
- artifacts,
- postmortem,
- event stream.

The user must be able to answer:

- What did Pyrfor decide?
- Why did it decide that?
- Which agent made the decision?
- Which tools ran?
- What evidence supports success?
- What failed?
- What was retried?
- What was learned?
- What needs approval?

---

## 2. Explicit Non-Goals

### 2.1 Not Unlimited Autonomy

Pyrfor v1 should not run arbitrary network, filesystem, deployment, payment, or destructive operations without policy gates.

### 2.2 Not a Replacement for Existing Ledgers

Do not build a new run database or separate workflow engine.

Extend:

- `run-ledger.ts`
- `event-ledger.ts`
- `durable-dag.ts`
- `artifact-model.ts`

### 2.3 Not a Single Super-Agent

The system should not rely on one giant prompt.

Use typed agents with contracts and boundaries.

### 2.4 Not Fully Self-Modifying by Default

The engine may propose improvements to itself.

Applying runtime or policy changes must be gated by verifier and approval tier.

### 2.5 Not Tool-Sprawl Without Governance

Forged tools must not become permanent merely because they worked once.

They require:

- schema,
- tests,
- sandbox profile,
- provenance,
- failure history,
- trust tier.

### 2.6 Not Web-Dependent Universality

Research may use web and MCP, but the engine must degrade gracefully offline.

Domain overlays, local memory, existing artifacts, and user clarification should cover offline runs.

### 2.7 Not Verification by Confidence

LLM confidence is not verification.

Verification requires concrete checks:

- tests,
- validators,
- static analysis,
- source evidence,
- user acceptance criteria,
- replayable commands,
- artifact hashes.

### 2.8 Not a Hidden Background Actor

Autonomous operation must remain observable.

Every phase emits events.

Every agent task is visible in DAG or actor mailbox state.

---

## 3. Core v1 Lifecycle

### 3.1 Lifecycle Overview

The v1 lifecycle is:

1. `ConceptIntake`
2. `Clarification`
3. `DomainResearch`
4. `PlanSynthesis`
5. `CapabilityGapAnalysis`
6. `ToolDiscovery`
7. `ToolForge`
8. `SandboxedExecution`
9. `TestSynthesis`
10. `AcceptanceVerification`
11. `SelfHealLoop`
12. `DeliveryPackager`
13. `PostMortem`
14. `MemoryWrite`

Each phase maps to:

- a `DurableDag` node kind,
- one or more actor mailbox tasks,
- event ledger entries,
- artifacts,
- budget scope,
- model policy,
- verifier gate.

---

## 4. ConceptIntake

### 4.1 Purpose

Convert raw user concept into a normalized run contract.

### 4.2 Inputs

- natural language concept,
- optional files,
- current workspace,
- selected autonomy profile,
- target deliverable hints,
- user/channel identity,
- optional domain overlay IDs,
- budget profile,
- permission profile.

### 4.3 Output Artifact

New artifact kind:

- `concept_contract`

Suggested schema:

```ts
interface ConceptContract {
  schemaVersion: 'pyrfor.concept_contract.v1';
  runId: string;
  concept: string;
  deliverableType:
    | 'code'
    | 'document'
    | 'research_report'
    | 'automation'
    | 'data_analysis'
    | 'design'
    | 'workflow'
    | 'mixed'
    | 'unknown';
  userIntent: string;
  knownConstraints: string[];
  assumedConstraints: string[];
  explicitSuccessCriteria: string[];
  inferredSuccessCriteria: string[];
  unknowns: ClarificationQuestion[];
  autonomyProfile: 'interactive' | 'notify' | 'supervised_autonomous' | 'autonomous';
  permissionProfile: 'strict' | 'standard' | 'autonomous';
  budgetProfile: unknown;
  requiredEvidence: string[];
  deliveryFormat: string[];
}
```

### 4.4 DurableDag Node

Node kind:

- `universal.concept_intake`

Dependencies:

- none.

Produces:

- `concept_contract` artifact,
- `run.created` event,
- `artifact.created` event.

### 4.5 Existing Primitives

Reuse:

- `RunLedger.createRun`
- `ArtifactStore.writeJSON`
- `ContextCompiler`
- `DomainOverlayRegistry`
- `gateway.ts` run creation patterns.

Extend:

- `artifact-model.ts` `ArtifactKind`
- `event-ledger.ts` event types.

### 4.6 New Module

Introduce:

- `universal/concept-intake.ts`

Responsibilities:

- normalize concept,
- classify deliverable,
- identify missing information,
- select initial domain overlays,
- emit concept contract.

---

## 5. Clarification

### 5.1 Purpose

Ask the smallest number of high-value questions before planning.

Clarification should be an interactive Q&A loop when required, not a one-shot prompt.

### 5.2 Question Policy

Ask only when the answer materially changes:

- success criteria,
- safety,
- target environment,
- deliverable format,
- external credentials,
- user preference,
- irreversible operation,
- legal/business constraints.

Do not ask for information the system can research or infer cheaply.

### 5.3 Question Types

Each question should include:

- `id`,
- `question`,
- `whyNeeded`,
- `impactIfUnknown`,
- `defaultAssumption`,
- `blocking`,
- `allowedAnswers`,
- `freeTextAllowed`.

### 5.4 Clarification States

- `not_needed`
- `pending_user`
- `answered`
- `defaulted`
- `expired`
- `blocked`

### 5.5 DurableDag Node

Node kind:

- `universal.clarification`

May block the DAG until answers arrive.

### 5.6 Event Types to Add

Extend `event-ledger.ts`:

- `clarification.requested`
- `clarification.answered`
- `clarification.defaulted`
- `clarification.blocked`

### 5.7 API Mapping

Gateway endpoints:

- `POST /api/universal/runs/:runId/clarifications/:questionId/answer`
- `GET /api/universal/runs/:runId/clarifications`
- `POST /api/universal/runs/:runId/clarifications/default`

### 5.8 Existing Primitives

Reuse:

- `ApprovalFlow` pattern for pending decisions.
- `RunLedger.blockRun` when clarification is blocking.
- `EventLedger.append`.
- `DurableDag.failNode` with `retryClass: 'human_needed'`.

### 5.9 New Module

Introduce:

- `universal/clarification-loop.ts`

Responsibilities:

- generate questions,
- rank questions,
- merge user answers,
- default non-blocking unknowns,
- unblock DAG nodes.

---

## 6. DomainResearch

### 6.1 Purpose

Build grounded context before planning or execution.

### 6.2 Research Sources

Use tiered research:

1. current workspace,
2. run/session history,
3. durable memory,
4. artifacts,
5. domain overlays,
6. MCP tools,
7. configured connectors,
8. web search/source capture,
9. user-provided documents.

### 6.3 Existing Modules to Reuse

Reuse:

- `research-search.ts`
- `research-source-capture.ts`
- `research-evidence.ts`
- `context-compiler.ts`
- `mcp-client.ts`
- `connectors`
- `workspace-loader.ts`
- `project-memory.ts`
- `memory-rollup.ts`

### 6.4 Output Artifacts

Add or reuse:

- `research_source_capture`
- `research_evidence`
- new `domain_research_brief`

Suggested schema:

```ts
interface DomainResearchBrief {
  schemaVersion: 'pyrfor.domain_research_brief.v1';
  runId: string;
  queryPlan: string[];
  sources: Array<{
    sourceId: string;
    kind: 'workspace' | 'memory' | 'artifact' | 'mcp' | 'web' | 'user';
    trust: 'high' | 'medium' | 'low';
    citation?: string;
    artifactId?: string;
  }>;
  findings: Array<{
    claim: string;
    confidence: 'high' | 'medium' | 'low';
    sourceIds: string[];
  }>;
  risks: string[];
  openQuestions: string[];
  planningImplications: string[];
}
```

### 6.5 DurableDag Nodes

Node kinds:

- `universal.domain_research.plan`
- `universal.domain_research.capture`
- `universal.domain_research.summarize`

### 6.6 Researcher Agent

The Researcher owns this phase.

It must not execute delivery side effects.

It may request capabilities but cannot forge tools itself.

---

## 7. PlanSynthesis

### 7.1 Purpose

Create a durable executable plan represented as `DurableDag` nodes.

The plan is not just markdown.

The plan is a graph.

### 7.2 Plan Artifact

New artifact kind:

- `universal_plan`

Schema:

```ts
interface UniversalPlan {
  schemaVersion: 'pyrfor.universal_plan.v1';
  runId: string;
  goal: string;
  assumptions: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  phases: UniversalPhase[];
  dagNodes: UniversalDagNodeSpec[];
  requiredCapabilities: CapabilityRequirement[];
  requiredTools: ToolRequirement[];
  verificationPlan: VerificationPlan;
  rollbackPlan: RollbackPlan;
  approvalGates: ApprovalGate[];
  budgetPlan: PhaseBudgetPlan[];
}
```

### 7.3 DurableDag Node Kinds

Plan synthesis emits concrete nodes such as:

- `universal.capability_gap_analysis`
- `universal.tool_discovery`
- `universal.tool_forge`
- `universal.execute.task`
- `universal.test_synthesis`
- `universal.acceptance_verification`
- `universal.self_heal`
- `universal.delivery_package`
- `universal.postmortem`
- `universal.memory_write`

### 7.4 Existing Primitive Mapping

Reuse:

- `RunLedger.proposePlan`
- `DurableDag.addNode`
- `ArtifactStore.writeJSON('plan')`
- `EventLedger` `plan.proposed`
- `approval-flow.ts`

Extend:

- `RunLedger.proposePlan` should accept a structured artifact ref in addition to markdown.
- `PlanProposedEvent` should include `artifact_id`, `plan_hash`, and `node_count`.

### 7.5 Approval Policy

Plan approval depends on autonomy profile:

- `interactive`: user must approve plan.
- `notify`: user is notified; safe/read-only phases may start.
- `supervised_autonomous`: plan starts unless high-risk effects exist.
- `autonomous`: plan starts if verifier accepts risk and policy allows.

### 7.6 New Module

Introduce:

- `universal/plan-synthesizer.ts`

Responsibilities:

- combine concept contract,
- clarification answers,
- research brief,
- memory,
- tool inventory,
- produce structured plan,
- materialize DAG nodes.

---

## 8. CapabilityGapAnalysis

### 8.1 Purpose

Determine whether Pyrfor can execute the plan with current tools and skills.

### 8.2 Capability Requirement Schema

```ts
interface CapabilityRequirement {
  id: string;
  description: string;
  operation:
    | 'read'
    | 'write'
    | 'execute'
    | 'network'
    | 'browser'
    | 'api'
    | 'analysis'
    | 'generation'
    | 'verification'
    | 'packaging';
  inputTypes: string[];
  outputTypes: string[];
  sideEffects: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiredTrustTier: ToolTrustTier;
  sandboxProfile: SandboxProfileId;
}
```

### 8.3 Gap Categories

- tool exists and trusted,
- tool exists but insufficient trust,
- tool exists but wrong sandbox,
- MCP tool available but unverified,
- external tool discoverable,
- tool must be forged,
- capability requires user credential,
- capability is disallowed.

### 8.4 DurableDag Node

Node kind:

- `universal.capability_gap_analysis`

### 8.5 Output Artifact

New artifact kind:

- `capability_gap_report`

### 8.6 Existing Primitives

Reuse:

- `PermissionEngine.ToolRegistry`
- `registerStandardTools`
- `mcp-client.ts`
- `connectors`
- `DomainOverlayRegistry`
- `worker-manifest.ts`

Extend:

- Current `ToolRegistry` is in-memory and minimal.
- It should become backed by a persistent `ToolCatalog` while keeping the same runtime registry API.

---

## 9. ToolDiscovery

### 9.1 Purpose

Find an existing safe capability before forging a new one.

### 9.2 Discovery Order

1. built-in Pyrfor tools,
2. dynamic skills from workspace,
3. registered ToolRegistry entries,
4. MCP tools from configured servers,
5. connector inventory,
6. local binaries inside allowed workspace,
7. package ecosystem metadata,
8. web documentation,
9. user-provided tool definitions.

### 9.3 Existing Modules to Reuse

Reuse:

- `permission-engine.ts`
- `tools.ts`
- `mcp-client.ts`
- `connectors`
- `federated-skills.ts`
- `workspace-loader.ts`
- `worker-manifest.ts`

### 9.4 Discovery Output

New artifact kind:

- `tool_discovery_report`

Schema fields:

- capability requirement id,
- candidates,
- source,
- trust tier,
- sandbox compatibility,
- license/provenance summary,
- test availability,
- selection decision.

### 9.5 Tool Discovery Policy

Prefer:

- existing verified tools,
- local deterministic tools,
- read-only tools,
- MCP tools with schemas,
- tools with test suites,
- narrow tools over broad shell commands.

Avoid:

- unbounded shell,
- unknown network clients,
- tools requiring broad credentials,
- opaque binaries,
- tools without reproducible tests.

---

## 10. ToolForge

### 10.1 Purpose

Create missing tools when discovery fails.

ToolForge must synthesize tools as first-class governed artifacts.

### 10.2 ToolForge Pipeline

The pipeline is:

1. capability spec,
2. tool design,
3. threat model,
4. sandbox profile selection,
5. implementation,
6. unit tests,
7. integration tests,
8. verifier run,
9. registry draft entry,
10. sandboxed trial,
11. promotion decision,
12. quarantine or registration.

### 10.3 DurableDag Node Kinds

- `universal.tool_forge.spec`
- `universal.tool_forge.impl`
- `universal.tool_forge.unit_tests`
- `universal.tool_forge.integration_tests`
- `universal.tool_forge.verify`
- `universal.tool_forge.promote`
- `universal.tool_forge.quarantine`

### 10.4 Tool Artifact Kinds

Extend `ArtifactKind` with:

- `tool_spec`
- `tool_impl`
- `tool_test_result`
- `tool_verification_report`
- `tool_registry_entry`
- `tool_threat_model`

### 10.5 ToolSpec Extension

Current `permission-engine.ts` `ToolSpec` fields:

- name,
- description,
- inputSchema,
- outputSchema,
- sideEffect,
- defaultPermission,
- timeoutMs,
- sandbox,
- idempotent,
- requiresApproval,
- auditRedact.

Extend with:

```ts
interface UniversalToolSpec extends ToolSpec {
  schemaVersion: 'pyrfor.tool_spec.v1';
  capability: string;
  signature: {
    inputSchema: unknown;
    outputSchema: unknown;
    examples: Array<{ input: unknown; output: unknown }>;
  };
  sandboxProfile: SandboxProfileId;
  provenance: {
    kind: 'builtin' | 'mcp' | 'forged' | 'connector' | 'workspace' | 'imported';
    sourceRefs: string[];
    authorAgent?: string;
    createdInRunId?: string;
    artifactIds: string[];
  };
  trustTier: ToolTrustTier;
  testSuite: {
    unitTestArtifactIds: string[];
    integrationTestArtifactIds: string[];
    lastRunArtifactId?: string;
    coverageSummary?: string;
  };
  failurePolicy: {
    maxConsecutiveFailures: number;
    quarantineOnPolicyViolation: boolean;
    quarantineOnVerifierFailure: boolean;
  };
  usageStats: {
    totalCalls: number;
    successes: number;
    failures: number;
    quarantines: number;
  };
}
```

### 10.6 Trust Tiers

Use:

- `draft`
- `sandboxed`
- `verified`
- `trusted`
- `deprecated`
- `quarantined`

Policy:

- `draft`: cannot be used for user deliverables.
- `sandboxed`: can run only inside restricted sandbox with synthetic inputs.
- `verified`: can run for low-risk real tasks.
- `trusted`: can run according to permission profile.
- `deprecated`: not selected for new plans unless explicitly requested.
- `quarantined`: blocked.

### 10.7 Tool Failure Policy

A tool is quarantined when:

- verifier fails safety,
- output schema is violated repeatedly,
- side effects exceed declared profile,
- it accesses disallowed paths,
- it exceeds budget repeatedly,
- it produces inconsistent deterministic outputs,
- user reports harm,
- dependency/provenance changes without re-verification.

### 10.8 Tool Eviction Policy

Evict or archive when:

- superseded by trusted replacement,
- unused over many runs,
- insecure dependency,
- incompatible runtime,
- duplicate capability,
- too broad compared with narrower alternatives.

Eviction should preserve artifacts and audit history.

### 10.9 New Modules

Introduce:

- `universal/tool-catalog.ts`
- `universal/tool-discovery.ts`
- `universal/tool-forge.ts`
- `universal/tool-quarantine.ts`
- `universal/tool-test-runner.ts`

### 10.10 Existing Modules to Mine Carefully

Archived modules may provide ideas but should not be blindly restored:

- `_archive/auto-tool-generator.ts`
- `_archive/skill-synth.ts`
- `_archive/plugin-loader.ts`
- `_archive/tool-router.ts`
- `_archive/shell-runner.ts`
- `_archive/self-improve-loop.ts`

Use only after review and migration to current primitives.

---

## 11. SandboxedExecution

### 11.1 Purpose

Execute planned work with host-owned side effects and sandbox constraints.

### 11.2 Execution Model

Agents do not directly mutate the world.

They emit worker frames through:

- ACP,
- FreeClaude bridge,
- actor mailbox,
- internal tool executor.

The host routes through:

- `WorkerProtocolBridge`,
- `ContractsBridge`,
- `PermissionEngine`,
- `TwoPhaseEffectRunner`,
- `Guardrails`,
- `ApprovalFlow`,
- `ArtifactStore`,
- `EventLedger`.

### 11.3 Sandbox Profiles

Define profiles:

#### `no-net`

- no outbound network,
- workspace read/write only if allowed,
- deterministic commands only,
- ideal for tests and local transforms.

#### `net-allowlist`

- outbound network only to approved hosts,
- source capture required for research,
- credentials scoped per connector.

#### `fs-scoped`

- filesystem access limited to workspace or run sandbox,
- no home directory traversal,
- no secrets path access unless explicitly approved.

#### `full`

- broad execution,
- always human approval,
- high audit verbosity,
- rollback required.

### 11.4 Sandbox Profile Schema

```ts
interface SandboxProfile {
  id: SandboxProfileId;
  network: 'none' | 'allowlist' | 'full';
  allowHosts?: string[];
  filesystem: {
    mode: 'read_only' | 'workspace_write' | 'run_sandbox' | 'full';
    roots: string[];
    denyGlobs: string[];
  };
  process: {
    allowShell: boolean;
    maxDurationMs: number;
    maxOutputBytes: number;
  };
  secrets: {
    access: 'none' | 'connector_scoped' | 'approved';
  };
  approvalRequired: boolean;
}
```

### 11.5 Existing Mapping

Reuse:

- `guardrails.ts`
- `permission-engine.ts`
- `approval-flow.ts`
- `process-manager.ts`
- `worker-protocol.ts`
- `contracts-bridge.ts`
- `two-phase-effect.ts`
- `pyrfor-fc-guardrails.ts`
- `pyrfor-fc-budget-guard.ts`

Extend:

- `ToolSpec.sandbox`
- permission profiles,
- guardrail policy matching,
- worker manifest domain scopes.

---

## 12. TestSynthesis

### 12.1 Purpose

Generate tests before final acceptance verification.

For code tasks, tests are executable.

For non-code tasks, tests are structured acceptance checks.

### 12.2 Test Types

- unit tests,
- integration tests,
- smoke tests,
- browser tests,
- schema validation,
- source citation checks,
- deliverable completeness checks,
- policy/safety checks,
- regression tests from prior failures,
- user acceptance criteria checks.

### 12.3 Existing Modules

Reuse:

- `browser-smoke.ts`
- `integration-harness.ts`
- `verify-engine.ts`
- `step-validator.ts`
- `quality-gate.ts`
- `VerifierLane`

### 12.4 Output Artifacts

Extend or reuse:

- `test_result`
- new `test_plan`
- new `acceptance_test_suite`

### 12.5 DurableDag Node

Node kind:

- `universal.test_synthesis`

### 12.6 Tester Agent Contract

The Tester must produce:

- test plan,
- test commands,
- expected outcomes,
- fixtures,
- test artifact refs,
- coverage notes,
- limitations.

The Tester does not declare acceptance.

The Verifier does.

---

## 13. AcceptanceVerification

### 13.1 Purpose

Independently determine whether the run satisfies the contract.

### 13.2 Inputs

- concept contract,
- clarification answers,
- universal plan,
- research brief,
- generated artifacts,
- execution logs,
- test results,
- tool provenance,
- acceptance criteria.

### 13.3 Verifier Outputs

- `passed`
- `warning`
- `failed`
- `blocked`
- `waived`

Existing `VerificationStatus` already supports these states.

### 13.4 Verification Report

Extend current reports with:

```ts
interface AcceptanceVerificationReport {
  schemaVersion: 'pyrfor.acceptance_verification.v1';
  runId: string;
  status: VerificationStatus;
  criteria: Array<{
    id: string;
    description: string;
    status: 'passed' | 'failed' | 'warning' | 'not_applicable';
    evidenceArtifactIds: string[];
    explanation: string;
  }>;
  testSummary: string;
  riskSummary: string;
  requiredUserReview: boolean;
  selfHealRecommended: boolean;
}
```

### 13.5 Existing Mapping

Reuse:

- `verifier-lane.ts`
- `verify-engine.ts`
- `quality-gate.ts`
- `step-validator.ts`
- `RunLedger.completeRun`
- `EventLedger` verifier events.

Extend:

- verifier subject types,
- verifier artifact kinds,
- gateway verifier endpoints.

---

## 14. SelfHealLoop

### 14.1 Purpose

Repair failures until success, budget exhaustion, policy block, or human intervention.

### 14.2 Triggers

- failed tests,
- verifier failure,
- tool failure,
- schema mismatch,
- missing artifact,
- budget warning,
- circuit health degradation,
- user rejection,
- delivery packaging failure.

### 14.3 Loop Structure

1. classify failure,
2. determine repair owner,
3. update plan/DAG,
4. allocate budget,
5. execute repair,
6. rerun relevant tests,
7. rerun verifier,
8. record outcome,
9. stop on convergence or block.

### 14.4 Failure Classes

- `planning_error`
- `research_gap`
- `tool_missing`
- `tool_bug`
- `execution_error`
- `test_failure`
- `acceptance_failure`
- `policy_block`
- `budget_block`
- `user_block`
- `external_dependency`

### 14.5 DurableDag Node

Node kind:

- `universal.self_heal`

Child nodes:

- `universal.self_heal.diagnose`
- `universal.self_heal.patch_plan`
- `universal.self_heal.execute_fix`
- `universal.self_heal.retest`
- `universal.self_heal.reverify`

### 14.6 Stop Conditions

Stop when:

- verifier passes,
- max repair attempts reached,
- budget exhausted,
- same failure repeats without improvement,
- required approval denied,
- unsafe tool behavior detected,
- user cancels.

### 14.7 Existing Mapping

Reuse:

- `DurableDag.failNode`
- retry classes:
  - `transient`
  - `deterministic`
  - `policy`
  - `human_needed`
- `RunLedger.blockRun`
- `VerifierLane`
- `TokenBudgetController`

---

## 15. DeliveryPackager

### 15.1 Purpose

Produce a user-facing deliverable package with evidence.

### 15.2 Package Contents

Every completed run should produce:

- final deliverable,
- summary,
- acceptance report,
- changed files or generated documents,
- artifact manifest,
- command/test evidence,
- known limitations,
- rollback instructions if effects were applied,
- next recommended actions.

### 15.3 Existing Modules

Reuse:

- `github-delivery-plan.ts`
- `github-delivery-apply.ts`
- `github-delivery-evidence.ts`
- `ArtifactStore`
- `export-cli.ts`
- `backup-restore.ts`

### 15.4 Output Artifacts

Reuse/extend:

- `delivery_plan`
- `delivery_apply`
- `delivery_evidence`
- new `delivery_package`
- new `artifact_manifest`

### 15.5 DurableDag Node

Node kind:

- `universal.delivery_package`

### 15.6 Delivery Targets

v1 should support:

- local files,
- artifact bundle,
- Git branch/patch,
- GitHub PR plan/apply path,
- research report,
- structured JSON output,
- VS Code workspace presentation.

Deployment to production environments should remain approval-gated.

---

## 16. PostMortem and MemoryWrite

### 16.1 Purpose

Extract reusable learning and store it safely.

### 16.2 PostMortem Artifact

New artifact kind:

- `postmortem`

Schema:

```ts
interface RunPostMortem {
  schemaVersion: 'pyrfor.postmortem.v1';
  runId: string;
  goal: string;
  outcome: 'completed' | 'failed' | 'cancelled' | 'blocked';
  summary: string;
  whatWorked: string[];
  whatFailed: string[];
  toolsUsed: string[];
  toolsForged: string[];
  verifierFindings: string[];
  reusablePatterns: string[];
  memoryWriteRecommendations: MemoryWriteRecommendation[];
  strategyRecommendations: StrategyRecommendation[];
}
```

### 16.3 Memory Write Gate

Not every observation becomes memory.

Memory writes require:

- usefulness,
- scope,
- source evidence,
- sensitivity classification,
- expiry or retention policy,
- verifier approval for strategic/procedural memory.

### 16.4 Existing Mapping

Reuse:

- `memory-store.ts`
- `memory-rollup.ts`
- `project-memory.ts`
- `ContextCompiler`
- `agent-memory-store`
- `EventLedger`
- `ArtifactStore`

Extend:

- structured memory classes,
- policy gates,
- memory provenance links.

---

## 17. Multi-Agent Topology

### 17.1 Agent Runtime Substrate

Use `ActorKernel` as the multi-agent substrate.

Each agent is represented as:

- actor id,
- child run id,
- role,
- budget,
- permission profile,
- mailbox tasks,
- proof artifacts.

Relevant existing file:

- `actor-kernel.ts`

### 17.2 Agent Communication

Agents communicate through:

- `EventLedger` events,
- `DurableDag` nodes,
- actor mailbox tasks,
- artifacts,
- context packs.

They should not share hidden mutable state.

### 17.3 Agent Protocol

Every agent task should include:

- task contract,
- input artifact refs,
- expected output schema,
- allowed tools,
- sandbox profile,
- budget,
- model class,
- verifier expectations.

### 17.4 Worker Frames

External or model-backed workers speak `worker-protocol.ts`.

Existing frame types:

- `plan_fragment`
- `proposed_patch`
- `proposed_command`
- `request_capability`
- `checkpoint`
- `heartbeat`
- `artifact_reference`
- `warning`
- `final_report`
- `failure_report`

Extend with optional v3 fields, not a parallel protocol:

- `agent_role`
- `phase`
- `input_artifact_ids`
- `output_schema`
- `confidence`
- `risk`
- `requires_verification`

---

## 18. Agent Contracts

### 18.1 Planner

#### Purpose

Convert concept, clarification, research, memory, and tool inventory into a durable plan.

#### Inputs

- `ConceptContract`
- clarification answers
- `DomainResearchBrief`
- memory context pack
- tool inventory
- user constraints
- budget profile

#### Outputs

- `UniversalPlan`
- DAG node specs
- approval gates
- acceptance criteria
- capability requirements

#### Tools

- context compiler,
- memory search,
- tool registry read,
- DAG planning API,
- artifact write.

#### Model Class

- premium for complex/mixed deliverables,
- standard for routine code/document tasks,
- fast only for plan formatting or low-risk decomposition.

#### Permissions

- read-only,
- no execution,
- no filesystem mutation except artifact writes.

---

### 18.2 Researcher

#### Purpose

Gather and ground domain knowledge.

#### Inputs

- concept contract,
- research questions,
- source policy,
- allowed connectors,
- domain overlays.

#### Outputs

- source captures,
- research evidence,
- research brief,
- open questions.

#### Tools

- workspace read,
- memory search,
- MCP read tools,
- web/source capture,
- connector inventory.

#### Model Class

- standard for most research,
- premium for conflicting evidence or specialized domains,
- fast for source triage.

#### Permissions

- read/network according to research policy,
- no write side effects beyond artifacts.

---

### 18.3 ToolForger

#### Purpose

Create missing tools safely.

#### Inputs

- capability gap report,
- selected tool requirement,
- sandbox profile,
- threat model template,
- examples,
- test requirements.

#### Outputs

- tool spec,
- implementation,
- unit tests,
- integration tests,
- verification report,
- registry draft entry.

#### Tools

- code generation,
- file write in tool sandbox,
- test runner,
- schema validator,
- package manager if allowed,
- artifact store.

#### Model Class

- premium for security-sensitive or complex tools,
- standard for simple deterministic tools,
- fast for test fixture generation.

#### Permissions

- sandboxed write/execute,
- no full workspace mutation unless approved,
- no promotion without verifier gate.

---

### 18.4 Coder

#### Purpose

Implement deliverable changes.

#### Inputs

- plan nodes,
- context pack,
- acceptance criteria,
- available tools,
- tests,
- constraints.

#### Outputs

- patches,
- generated files,
- command proposals,
- implementation notes,
- artifact references.

#### Tools

- read/search files,
- propose patches,
- run allowed commands,
- use registered tools.

#### Model Class

- standard for implementation,
- premium for architecture-heavy or high-risk changes,
- fast for mechanical edits.

#### Permissions

- host-owned effects only,
- sandbox profile inherited from plan node.

---

### 18.5 Tester

#### Purpose

Create and run tests.

#### Inputs

- acceptance criteria,
- deliverable artifacts,
- code changes,
- tool specs,
- prior failures.

#### Outputs

- test plan,
- test files,
- test result artifacts,
- failure classification.

#### Tools

- test runners,
- browser smoke,
- schema validation,
- command execution.

#### Model Class

- standard,
- fast for routine test generation,
- premium for ambiguous acceptance criteria.

#### Permissions

- execute tests in sandbox,
- write test files if plan allows.

---

### 18.6 Verifier / Critic

#### Purpose

Independently decide correctness.

#### Inputs

- all relevant artifacts,
- event ledger slice,
- DAG state,
- test results,
- acceptance criteria,
- source evidence,
- worker final reports.

#### Outputs

- verification report,
- pass/fail/block decision,
- self-heal recommendation,
- waiver eligibility.

#### Tools

- `VerifierLane`,
- validators,
- quality gate,
- artifact verification,
- command replay if allowed.

#### Model Class

- premium for final acceptance,
- standard for intermediate checks,
- fast only for deterministic summary extraction.

#### Permissions

- read-only by default,
- execution only for verifier-owned replay/test sandbox.

---

### 18.7 Reviewer

#### Purpose

Review implementation quality, maintainability, risks, and user-facing quality.

#### Inputs

- diff,
- plan,
- tests,
- research,
- verifier report.

#### Outputs

- review findings,
- severity-ranked issues,
- recommendations.

#### Tools

- static analysis,
- code search,
- artifact read,
- test result read.

#### Model Class

- standard,
- premium for high-risk/security-sensitive work.

#### Permissions

- read-only.

---

### 18.8 Strategist

#### Purpose

Guide long-term decisions and autonomy strategy.

#### Inputs

- user goals,
- strategic memory,
- run postmortems,
- recurring patterns,
- domain overlays.

#### Outputs

- strategy recommendations,
- plan constraints,
- memory write recommendations,
- autonomy recommendations.

#### Tools

- Strategy Store,
- goal store,
- memory search,
- postmortem artifacts.

#### Model Class

- premium for major strategy changes,
- standard for routine preference application.

#### Permissions

- read strategic memory,
- propose writes,
- cannot apply policy changes without approval.

---

### 18.9 Historian

#### Purpose

Maintain memory continuity.

#### Inputs

- event ledger,
- artifacts,
- postmortem,
- user feedback,
- project memory.

#### Outputs

- episodic summary,
- semantic facts,
- procedural patterns,
- memory write proposals.

#### Tools

- memory store,
- project rollup,
- context compiler,
- artifact read.

#### Model Class

- standard,
- fast for summarization,
- premium for conflict resolution.

#### Permissions

- write episodic memory automatically,
- strategic/procedural writes gated.

---

### 18.10 Overseer

#### Purpose

Coordinate phases, budgets, approvals, health, and escalation.

#### Inputs

- run state,
- DAG state,
- budget snapshot,
- circuit health,
- approval state,
- verifier state.

#### Outputs

- scheduling decisions,
- escalation decisions,
- cancellation/block decisions,
- phase transitions.

#### Tools

- RunLedger,
- DurableDag,
- EventLedger,
- TokenBudgetController,
- ApprovalFlow,
- circuit router status.

#### Model Class

- fast or deterministic controller for routine scheduling,
- standard for ambiguous escalation,
- premium only for high-level replanning.

#### Permissions

- control-plane only,
- no direct deliverable mutation.

---

## 19. Bus and Protocol

### 19.1 EventLedger as Audit Bus

`EventLedger` should remain append-only JSONL.

Extend its event union to include v1 universal events.

New event categories:

- concept,
- clarification,
- research,
- capability,
- tool discovery,
- tool forge,
- sandbox,
- test synthesis,
- acceptance,
- self-heal,
- delivery,
- memory,
- meta-critic.

### 19.2 Proposed Event Types

Add:

- `concept.intake.completed`
- `clarification.requested`
- `clarification.answered`
- `research.started`
- `research.completed`
- `capability.gap.detected`
- `tool.discovery.started`
- `tool.discovery.completed`
- `tool.forge.started`
- `tool.forge.completed`
- `tool.promoted`
- `tool.quarantined`
- `sandbox.execution.started`
- `sandbox.execution.completed`
- `test.synthesis.completed`
- `acceptance.verification.completed`
- `self_heal.started`
- `self_heal.completed`
- `delivery.packaged`
- `postmortem.created`
- `memory.write.proposed`
- `memory.write.committed`
- `meta_critic.proposed`

### 19.3 DurableDag as Task Bus

`DurableDag` remains the task graph.

Every phase is a node or subgraph.

Every agent mailbox task is a node.

Every node should include:

- kind,
- payload,
- dependencies,
- idempotency key,
- retry class,
- timeout class,
- compensation policy,
- provenance links.

### 19.4 ArtifactStore as Evidence Bus

Every non-trivial output should be an artifact.

Add artifact kinds for v1 rather than new stores.

Suggested additions:

- `concept_contract`
- `clarification_record`
- `domain_research_brief`
- `universal_plan`
- `capability_gap_report`
- `tool_discovery_report`
- `tool_spec`
- `tool_impl`
- `tool_test_result`
- `tool_verification_report`
- `tool_registry_entry`
- `test_plan`
- `acceptance_test_suite`
- `acceptance_verification`
- `delivery_package`
- `artifact_manifest`
- `postmortem`
- `memory_write_proposal`
- `meta_critic_report`

---

## 20. Mapping to Existing Runtime Files

### 20.1 Reuse Directly

Reuse these as foundational primitives:

- `runtime/index.ts`
- `run-ledger.ts`
- `event-ledger.ts`
- `durable-dag.ts`
- `artifact-model.ts`
- `verifier-lane.ts`
- `actor-kernel.ts`
- `orchestration-host-factory.ts`
- `worker-protocol.ts`
- `worker-protocol-bridge.ts`
- `contracts-bridge.ts`
- `two-phase-effect.ts`
- `approval-flow.ts`
- `guardrails.ts`
- `permission-engine.ts`
- `token-budget-controller.ts`
- `pyrfor-fc-circuit-router.ts`
- `pyrfor-fc-guardrails.ts`
- `pyrfor-fc-budget-guard.ts`
- `gateway.ts`
- `context-compiler.ts`
- `context-pack.ts`
- `mcp-client.ts`
- `research-search.ts`
- `research-source-capture.ts`
- `research-evidence.ts`
- `browser-smoke.ts`
- `github-delivery-plan.ts`
- `github-delivery-apply.ts`
- `github-delivery-evidence.ts`
- `project-memory.ts`
- `memory-rollup.ts`
- `goal-store.ts`
- `domain-overlay.ts`
- `domain-overlay-presets.ts`
- `worker-manifest.ts`

### 20.2 Extend Existing Files

#### `artifact-model.ts`

Add artifact kinds listed above.

#### `event-ledger.ts`

Add universal event union members.

Keep JSONL append-only behavior unchanged.

#### `durable-dag.ts`

No structural replacement.

Potential extensions:

- phase metadata,
- priority,
- typed node kind helpers,
- richer query helpers.

#### `run-ledger.ts`

Extend plan APIs to accept structured plan artifact refs.

Add helper methods:

- `recordPhaseStarted`
- `recordPhaseCompleted`
- `recordMemoryWrite`
- `recordToolPromotion`
- `recordSelfHealAttempt`

These still append `EventLedger` events.

#### `permission-engine.ts`

Extend `ToolSpec`.

Make `ToolRegistry` support persistent catalog import/export while preserving current API.

#### `guardrails.ts`

Add sandbox profile and trust tier awareness.

#### `token-budget-controller.ts`

Add phase-level budget scopes or encode phase as `targetId`.

Recommended extension:

- `BudgetScope = 'phase' | 'task' | 'session' | 'global'`

#### `verifier-lane.ts`

Add subject types:

- `concept_contract`
- `universal_plan`
- `tool_spec`
- `tool_impl`
- `delivery_package`
- `memory_write`
- `meta_improvement`

#### `gateway.ts`

Add universal endpoints while reusing existing auth, rate limiting, SSE, runs, artifacts, approvals, and verifier endpoints.

#### `runtime/index.ts`

Add `UniversalEngineService` composition inside `PyrforRuntime`.

Do not bloat `PyrforRuntime` with all phase logic.

### 20.3 New Modules to Introduce

Under:

`packages/engine/src/runtime/universal/`

Add:

- `types.ts`
- `universal-engine-service.ts`
- `concept-intake.ts`
- `clarification-loop.ts`
- `domain-research-orchestrator.ts`
- `plan-synthesizer.ts`
- `capability-gap-analysis.ts`
- `tool-catalog.ts`
- `tool-discovery.ts`
- `tool-forge.ts`
- `tool-quarantine.ts`
- `sandbox-profiles.ts`
- `phase-budget-policy.ts`
- `agent-contracts.ts`
- `agent-topology.ts`
- `execution-orchestrator.ts`
- `test-synthesis.ts`
- `acceptance-verification.ts`
- `self-heal-loop.ts`
- `delivery-packager.ts`
- `postmortem.ts`
- `memory-write-policy.ts`
- `meta-critic.ts`

### 20.4 Do Not Introduce

Do not introduce separate:

- workflow engine,
- event bus,
- artifact store,
- approval system,
- model router,
- verifier system,
- memory database for per-run evidence.

---

## 21. Tool Model

### 21.1 ToolRegistry Layers

Use three layers:

1. runtime registry,
2. persistent catalog,
3. discovery adapters.

The current `ToolRegistry` in `permission-engine.ts` remains the runtime registry.

New `ToolCatalog` persists specs and history.

Discovery adapters populate candidate tools.

### 21.2 Registry Entry Schema

A registry entry should include:

- identity,
- capability,
- signature,
- side effects,
- sandbox,
- provenance,
- trust tier,
- tests,
- failure policy,
- usage stats,
- approval requirements.

### 21.3 Capability Matching

Tool selection should rank by:

- capability fit,
- trust tier,
- sandbox compatibility,
- schema fit,
- deterministic behavior,
- prior success rate,
- cost,
- latency,
- approval friction.

### 21.4 Tool Promotion

Promotion gates:

#### Draft to Sandboxed

Requires:

- valid schema,
- implementation artifact,
- threat model,
- unit tests generated.

#### Sandboxed to Verified

Requires:

- unit tests pass,
- integration tests pass,
- verifier passes,
- no policy violations.

#### Verified to Trusted

Requires:

- successful real-run usage,
- no quarantines,
- human approval or policy rule allowing promotion.

### 21.5 Quarantine

Quarantine immediately blocks selection.

A quarantined tool can be:

- inspected,
- repaired,
- retested,
- restored to sandboxed,
- deprecated,
- evicted.

### 21.6 MCP Tool Handling

MCP tools enter as discovered external tools.

Default trust tier:

- `sandboxed` or lower.

They require:

- server provenance,
- input schema,
- output shape observation,
- permission mapping,
- call timeout,
- network profile.

---

## 22. Memory Architecture

### 22.1 Episodic Memory

Per-run memory.

Source:

- `EventLedger`
- `RunLedger`
- `DurableDag`
- artifacts.

Stored as:

- run postmortem,
- event summaries,
- execution traces.

Read by:

- Planner,
- Verifier,
- Historian,
- Overseer.

Write policy:

- automatic at run end,
- verifier can flag omissions,
- sensitive data redacted.

### 22.2 Semantic Memory

Facts extracted from artifacts and run outcomes.

Examples:

- project architecture facts,
- API behavior,
- recurring errors,
- domain facts,
- test commands,
- source citations.

Stored in:

- vector index,
- relational metadata,
- artifact references.

Read by:

- Planner,
- Researcher,
- Coder,
- Tester,
- Verifier.

Write policy:

- requires source artifacts,
- confidence score,
- scope,
- expiry for volatile facts.

### 22.3 Strategic Memory

User goals, preferences, patterns, decisions.

Existing seed:

- `goal-store.ts`

Extend with:

- `StrategyStore`.

Examples:

- preferred autonomy level,
- coding style preferences,
- delivery format preferences,
- risk tolerance,
- recurring business goals.

Read by:

- Planner,
- Strategist,
- Overseer,
- DeliveryPackager.

Write policy:

- proposed by Strategist or Historian,
- gated by verifier,
- human approval for high-impact preferences.

### 22.4 Procedural Memory

Reusable ways of doing work.

Examples:

- “for this repo, run this test command”
- “for this API, use this MCP server”
- “for this deliverable type, use this plan template”
- “this forged tool solves this capability”

Read by:

- Planner,
- ToolForger,
- Coder,
- Tester,
- Overseer.

Write policy:

- requires successful run evidence,
- associated with tests or verifier pass,
- demoted if future failures occur.

### 22.5 Memory Read Policy by Agent

Planner reads:

- strategic,
- semantic,
- procedural,
- recent episodic.

Researcher reads:

- semantic,
- procedural source patterns,
- relevant episodic.

ToolForger reads:

- procedural,
- tool history,
- semantic API docs.

Coder reads:

- semantic project facts,
- procedural repo patterns,
- current context pack.

Tester reads:

- procedural test patterns,
- prior failure memories,
- acceptance criteria.

Verifier reads:

- episodic,
- semantic evidence,
- plan artifacts,
- test artifacts.

Reviewer reads:

- semantic project norms,
- procedural review patterns.

Strategist reads:

- strategic,
- postmortems,
- long-run episodic summaries.

Historian reads:

- all run artifacts,
- ledger,
- postmortem.

Overseer reads:

- budgets,
- run state,
- approval state,
- strategic autonomy policy.

---

## 23. Self-Improvement Loop

### 23.1 Meta-Critic

After each run, a Meta-Critic proposes improvements to:

- plans,
- tools,
- policies,
- memory,
- prompts,
- domain overlays,
- verifier checks,
- budget rules.

### 23.2 Meta-Critic Inputs

- postmortem,
- verifier report,
- failed DAG nodes,
- tool failure history,
- budget usage,
- approval friction,
- user feedback,
- delivery quality.

### 23.3 Meta-Critic Outputs

New artifact kind:

- `meta_critic_report`

Schema:

```ts
interface MetaCriticReport {
  schemaVersion: 'pyrfor.meta_critic_report.v1';
  runId: string;
  proposals: Array<{
    id: string;
    category:
      | 'plan_pattern'
      | 'tool_improvement'
      | 'policy_change'
      | 'memory_write'
      | 'verifier_check'
      | 'budget_rule'
      | 'domain_overlay';
    recommendation: string;
    evidenceArtifactIds: string[];
    risk: 'low' | 'medium' | 'high';
    approvalTier: 'autonomous' | 'notify' | 'approve';
  }>;
}
```

### 23.4 Gating

Meta improvements are applied according to tier:

- low-risk procedural memories: autonomous after verifier pass,
- tool repairs: sandboxed only,
- trusted tool promotion: approval,
- policy changes: approval,
- sandbox loosening: approval,
- verifier weakening: approval,
- verifier strengthening: notify or autonomous if low risk.

### 23.5 Existing Mapping

Reuse:

- `VerifierLane`
- `ApprovalFlow`
- `ArtifactStore`
- `EventLedger`
- archived `_archive/self-improve-loop.ts` only as reference.

---

## 24. Safety and Guardrails

### 24.1 Approval Modes

Use three operator-facing levels:

#### Autonomous

Engine proceeds without interruption.

Allowed for:

- read-only,
- safe local writes,
- verified tools,
- no-net tests,
- low-risk memory writes.

#### Notify

Engine proceeds but emits visible notice.

Used for:

- moderate cost,
- verified network reads,
- generated tool sandbox trials,
- non-destructive workspace changes.

#### Approve

Engine blocks until approval.

Used for:

- destructive operations,
- broad network,
- secrets,
- deployments,
- tool trust promotion,
- policy changes,
- full sandbox,
- external writes.

### 24.2 Tool Trust + Sandbox Matrix

A low-trust tool cannot request a high-power sandbox.

Examples:

- `draft` + `full`: impossible.
- `sandboxed` + `no-net`: allowed for tests.
- `verified` + `fs-scoped`: allowed with plan approval.
- `trusted` + `net-allowlist`: allowed under policy.
- any + `full`: approval required.

### 24.3 Circuit Router Health Gates

The FreeClaude circuit router should gate worker execution.

If health degrades:

- downgrade model,
- switch provider,
- pause non-critical agents,
- ask Overseer to reschedule,
- block high-risk phases.

Reuse:

- `pyrfor-fc-circuit-router.ts`
- provider router patterns.

### 24.4 Budget Gates

`TokenBudgetController` should enforce:

- preflight estimate,
- per-phase cap,
- warning threshold,
- hard block,
- downgrade trigger.

### 24.5 Rollback

Rollback should use:

- `RunLedger` snapshots,
- `DurableDag` compensation policy,
- `TwoPhaseEffectRunner` rollback handles,
- artifact manifests,
- patch reverse operations where possible.

### 24.6 Audit Trail

All of the following must be recorded:

- agent task assignment,
- model turn,
- tool request,
- tool approval,
- tool execution,
- effect proposal,
- policy decision,
- effect application,
- artifact write,
- verifier decision,
- approval decision,
- memory write,
- tool promotion/quarantine.

---

## 25. Multi-Model Orchestration Policy

### 25.1 Model Classes

Define model classes:

- `fast`
- `standard`
- `premium`
- `local`
- `specialist`

### 25.2 Agent Defaults

Planner:

- standard by default,
- premium for large ambiguous plans.

Researcher:

- standard,
- fast for source triage.

ToolForger:

- standard,
- premium for security/tool architecture.

Coder:

- standard,
- premium for complex systems.

Tester:

- standard,
- fast for simple tests.

Verifier:

- premium for final acceptance,
- standard for intermediate checks.

Reviewer:

- standard,
- premium for security/critical code.

Strategist:

- premium for strategic memory/policy,
- standard for routine patterns.

Historian:

- fast or standard.

Overseer:

- deterministic/fast for scheduling,
- standard for replanning.

### 25.3 Failover

Use existing router/circuit mechanisms:

- `ProviderRouter`
- `pyrfor-fc-circuit-router.ts`
- budget guard.

Failover policy:

1. retry same class on transient provider failure,
2. switch provider same class,
3. downgrade if budget pressure and risk is low,
4. upgrade if verifier detects ambiguity,
5. block if no safe model available.

### 25.4 Budget-Aware Downgrade

Downgrade allowed for:

- summarization,
- formatting,
- source triage,
- routine test scaffolds,
- artifact manifest generation.

Downgrade disallowed for:

- final verifier decision,
- policy loosening,
- tool promotion,
- destructive operation planning,
- security-sensitive tool forge.

---

## 26. Gateway API Surface

### 26.1 Existing Gateway

`gateway.ts` already has:

- health,
- settings,
- chat,
- runs,
- run events,
- run DAG,
- run actors,
- context packs,
- research,
- delivery,
- verifier,
- approvals,
- audit events,
- filesystem,
- git,
- models.

v1 should add `/api/universal/*` while reusing current auth/rate-limit/SSE helpers.

### 26.2 Concept Submit

`POST /api/universal/concepts`

Request:

```json
{
  "concept": "string",
  "workspaceId": "string",
  "autonomyProfile": "interactive | notify | supervised_autonomous | autonomous",
  "deliverableHints": ["code"],
  "domainIds": ["string"],
  "budgetProfile": {},
  "permissionProfile": "strict | standard | autonomous"
}
```

Response:

```json
{
  "runId": "string",
  "conceptContractArtifact": {},
  "clarificationRequired": true,
  "status": "created"
}
```

### 26.3 Clarify

`GET /api/universal/runs/:runId/clarifications`

`POST /api/universal/runs/:runId/clarifications/:questionId/answer`

`POST /api/universal/runs/:runId/clarifications/default`

### 26.4 Plan Inspect

`GET /api/universal/runs/:runId/plan`

Returns:

- plan artifact,
- DAG projection,
- approval gates,
- risks,
- budget plan.

### 26.5 Approve

`POST /api/universal/runs/:runId/approve`

Body:

```json
{
  "approvalId": "string",
  "decision": "approve | deny",
  "reason": "string"
}
```

Should delegate to existing `ApprovalFlow`.

### 26.6 Run Control

`POST /api/universal/runs/:runId/start`

`POST /api/universal/runs/:runId/pause`

`POST /api/universal/runs/:runId/resume`

`POST /api/universal/runs/:runId/cancel`

Map to existing run control and DAG scheduling.

### 26.7 Status

`GET /api/universal/runs/:runId/status`

Return:

- run state,
- current phase,
- DAG summary,
- actor summary,
- budget snapshot,
- pending approvals,
- verifier state,
- last event seq.

### 26.8 Artifacts

`GET /api/universal/runs/:runId/artifacts`

`GET /api/universal/runs/:runId/artifacts/:artifactId`

Expose public artifact refs, not raw unsafe paths.

### 26.9 Postmortem

`GET /api/universal/runs/:runId/postmortem`

`POST /api/universal/runs/:runId/postmortem/generate`

### 26.10 Tool Catalog

`GET /api/universal/tools`

`GET /api/universal/tools/:toolId`

`POST /api/universal/tools/:toolId/promote`

`POST /api/universal/tools/:toolId/quarantine`

`POST /api/universal/tools/discover`

### 26.11 Event Stream

Either reuse:

- `/api/events/stream`

or add filtered:

- `GET /api/universal/runs/:runId/stream`

---

## 27. CLI Surface

### 27.1 Commands

Add:

- `pyrfor universal submit "<concept>"`
- `pyrfor universal clarify <runId>`
- `pyrfor universal plan <runId>`
- `pyrfor universal approve <runId> <approvalId>`
- `pyrfor universal run <runId>`
- `pyrfor universal status <runId>`
- `pyrfor universal events <runId>`
- `pyrfor universal artifacts <runId>`
- `pyrfor universal package <runId>`
- `pyrfor universal postmortem <runId>`
- `pyrfor tools list`
- `pyrfor tools discover <capability>`
- `pyrfor tools inspect <toolId>`
- `pyrfor tools quarantine <toolId>`
- `pyrfor memory strategy list`
- `pyrfor memory strategy approve <proposalId>`

### 27.2 CLI Principles

The CLI should be a thin client over gateway/runtime services.

No separate orchestration.

---

## 28. VS Code Extension Surface

### 28.1 Universal Run Panel

Show:

- concept,
- current phase,
- DAG graph,
- agents,
- pending approvals,
- budget,
- verifier status,
- artifact list.

### 28.2 Clarification UI

Render questions as forms:

- multiple choice,
- free text,
- default assumption,
- blocking marker.

### 28.3 Plan Inspector

Show:

- phase graph,
- risks,
- tool requirements,
- sandbox profiles,
- approval gates.

### 28.4 Tool Catalog UI

Show:

- trusted tools,
- forged tools,
- quarantined tools,
- test status,
- provenance.

### 28.5 Evidence Viewer

Show:

- test results,
- verifier reports,
- source captures,
- delivery package.

### 28.6 Memory Review UI

Show proposed:

- strategic memory,
- procedural patterns,
- tool promotions,
- policy improvements.

Allow approve/deny.

---

## 29. Implementation Milestones

### Milestone 1: Universal Types and Artifact/Event Extensions

Deliver:

- `universal/types.ts`
- added artifact kinds,
- added event types,
- tests for serialization/parsing,
- no orchestration behavior yet.

Depends on:

- existing ledgers and artifact store.

### Milestone 2: ConceptIntake Service

Deliver:

- `concept-intake.ts`
- concept contract artifact,
- gateway concept submit endpoint,
- run creation integration,
- tests.

Depends on:

- Milestone 1.

### Milestone 3: Clarification Loop

Deliver:

- clarification question schema,
- pending clarification state,
- gateway answer endpoints,
- DAG block/unblock behavior,
- event logging.

Depends on:

- Milestone 2.

### Milestone 4: Structured PlanSynthesis

Deliver:

- universal plan schema,
- plan artifact,
- DAG materialization,
- plan inspection endpoint,
- approval integration.

Depends on:

- Milestone 3.

### Milestone 5: Agent Topology on ActorKernel

Deliver:

- standard agent contracts,
- actor spawn helpers,
- mailbox task templates,
- context pack integration,
- agent event visibility.

Depends on:

- Milestone 4.

### Milestone 6: CapabilityGapAnalysis and Tool Discovery

Deliver:

- capability requirement schema,
- tool discovery report,
- MCP/built-in/tool registry discovery adapters,
- selection policy.

Depends on:

- Milestone 5.

### Milestone 7: Persistent Tool Catalog

Deliver:

- catalog persistence,
- extended tool spec,
- trust tiers,
- failure stats,
- gateway tool endpoints.

Depends on:

- Milestone 6.

### Milestone 8: ToolForge Sandbox Pipeline

Deliver:

- spec-to-implementation pipeline,
- generated tests,
- verifier gate,
- registry draft/sandbox promotion,
- quarantine behavior.

Depends on:

- Milestone 7.

### Milestone 9: Sandboxed Execution Profiles

Deliver:

- sandbox profile schema,
- permission integration,
- guardrail integration,
- worker manifest integration,
- policy tests.

Depends on:

- Milestone 8.

### Milestone 10: TestSynthesis

Deliver:

- test plan artifact,
- acceptance test suite artifact,
- tester agent contract,
- integration with existing test/browser/verify modules.

Depends on:

- Milestone 9.

### Milestone 11: AcceptanceVerification Extension

Deliver:

- acceptance verification report,
- verifier subject extensions,
- final verification endpoint,
- self-heal trigger integration.

Depends on:

- Milestone 10.

### Milestone 12: SelfHealLoop

Deliver:

- failure classifier,
- repair DAG expansion,
- retry budget policy,
- convergence detection,
- event/artifact trace.

Depends on:

- Milestone 11.

### Milestone 13: DeliveryPackager

Deliver:

- delivery package artifact,
- artifact manifest,
- gateway package endpoint,
- CLI package command.

Depends on:

- Milestone 12.

### Milestone 14: PostMortem and MemoryWrite

Deliver:

- postmortem artifact,
- memory write proposals,
- episodic automatic write,
- strategic/procedural approval gates.

Depends on:

- Milestone 13.

### Milestone 15: Meta-Critic

Deliver:

- meta-critic report,
- improvement proposal schema,
- verifier gate,
- approval integration.

Depends on:

- Milestone 14.

### Milestone 16: CLI and VS Code UX

Deliver:

- universal CLI commands,
- VS Code run panel,
- clarification UI,
- plan inspector,
- evidence viewer.

Depends on:

- core API milestones.

### Milestone 17: End-to-End Golden Runs

Deliver golden scenarios:

- code change with tests,
- research report with citations,
- forged simple tool,
- self-healing failed test,
- delivery package,
- memory write review.

Depends on:

- Milestones 1–16.

---

## 30. Risks

### 30.1 Scope Explosion

“Universal” can become unfocused.

Mitigation:

- contract-driven intake,
- typed deliverables,
- domain overlays,
- phased milestones.

### 30.2 Unsafe Tool Creation

Forged tools may have unintended side effects.

Mitigation:

- sandbox-first,
- trust tiers,
- verifier gate,
- quarantine,
- no automatic trusted promotion.

### 30.3 Verification Weakness

The engine may pass bad work if verification is shallow.

Mitigation:

- independent verifier,
- generated tests,
- acceptance criteria,
- source evidence,
- replay artifacts,
- user review gates.

### 30.4 Cost Blowups

Autonomous multi-agent loops can consume excessive tokens.

Mitigation:

- phase budgets,
- model downgrade,
- hard budget blocks,
- Overseer scheduling.

### 30.5 Memory Pollution

Bad memories degrade future runs.

Mitigation:

- typed memory,
- provenance,
- verifier gates,
- confidence scores,
- memory correction endpoints.

### 30.6 Tool Registry Rot

Tools may become stale or insecure.

Mitigation:

- usage stats,
- re-verification,
- quarantine,
- deprecation,
- eviction.

### 30.7 Hidden Coupling to FreeClaude

The architecture should not depend on one worker transport.

Mitigation:

- keep ACP/worker protocol canonical,
- route FreeClaude as one adapter,
- host-owned effects.

### 30.8 Overloaded Gateway

`gateway.ts` is already large.

Mitigation:

- add route handlers that delegate to `UniversalEngineService`,
- avoid embedding phase logic directly in gateway.

### 30.9 User Trust

Users may not trust autonomous actions.

Mitigation:

- plan inspector,
- event stream,
- approval gates,
- artifact evidence,
- postmortem,
- rollback handles.

---

## 31. Open Questions

### 31.1 Scope of “Universal”

Which deliverable types are first-class in v1?

Recommended initial set:

- code changes,
- research reports,
- automation scripts,
- document generation,
- data analysis,
- mixed code+research tasks.

### 31.2 Default Autonomy

What should be the default?

Recommendation:

- `supervised_autonomous` for trusted local work,
- `interactive` for new users,
- `notify` for research-only tasks,
- `approve` gates for destructive/network-write actions.

### 31.3 ToolForge Language

Which implementation languages are allowed for forged tools?

Recommendation:

- TypeScript first,
- shell only for wrappers,
- Python optionally for data tasks,
- compiled/native tools require approval.

### 31.4 Sandbox Backend

Which sandbox runtime should v1 use?

Options:

- process-level policy only,
- container sandbox,
- macOS sandbox profile,
- remote isolated runner.

Recommendation:

- start with policy + fs-scoped run directories,
- design interfaces for stronger backends.

### 31.5 Memory Backend

Which vector/relational store should be canonical?

Recommendation:

- keep `ArtifactStore` and JSONL ledgers as source of truth,
- add replaceable memory index backend,
- never make vector DB the only source of truth.

### 31.6 Tool Promotion Authority

Who can promote tools to trusted?

Recommendation:

- verifier can recommend,
- policy can auto-promote only low-risk procedural tools,
- human approves trusted/high-risk promotion.

### 31.7 Domain Overlay Ownership

Who writes and approves domain overlays?

Recommendation:

- system can propose,
- user or maintainer approves,
- overlays carry provenance and version.

---

## 32. Recommended User Decisions

### 32.1 Choose Initial Deliverable Types

Recommended v1 defaults:

- code,
- research report,
- local automation,
- document/report,
- mixed project task.

Defer:

- production deployment,
- financial actions,
- legal filing,
- medical advice,
- irreversible external operations.

### 32.2 Choose Default Autonomy

Recommended default:

- `supervised_autonomous`

Meaning:

- safe/read-only proceeds,
- local write with reversible patch proceeds after plan approval,
- network write/destructive/full sandbox requires approval.

### 32.3 Choose Sandbox Baseline

Recommended baseline:

- `fs-scoped` for implementation,
- `no-net` for tests,
- `net-allowlist` for research,
- `full` only by explicit approval.

### 32.4 Choose ToolForge Default

Recommended:

- forge tools only when discovery fails,
- generated tools start as `draft`,
- first real use requires `sandboxed` verification,
- promotion to `trusted` requires approval.

### 32.5 Choose Memory Approval Rules

Recommended:

- episodic memory automatic,
- semantic memory automatic with provenance,
- procedural memory verifier-gated,
- strategic memory human-approved.

### 32.6 Choose Gateway Exposure

Recommended:

- expose `/api/universal/*` behind existing gateway auth,
- keep raw artifact paths private,
- stream events through authenticated SSE,
- require approval endpoint auth.

---

## 33. Target v1 Shape

Pyrfor Universal Engine v1 should feel like this:

1. User submits a concept.
2. Engine creates a run and concept contract.
3. Engine asks only necessary clarification questions.
4. Engine researches the domain with source evidence.
5. Planner produces a durable DAG-backed plan.
6. User or policy approves the plan.
7. Capability analysis finds missing tools.
8. Tool discovery reuses existing capabilities where possible.
9. ToolForge creates and verifies missing tools only when needed.
10. Agents execute tasks through host-owned effects.
11. Tester synthesizes and runs checks.
12. Verifier independently judges acceptance.
13. SelfHeal repairs failures within budget and policy.
14. DeliveryPackager emits a final evidence-backed package.
15. Historian writes memory.
16. Meta-Critic proposes safe improvements.
17. Every step is visible, auditable, replayable, and governed.

The central design rule is simple:

> Universal autonomy is allowed only when it is durable, inspectable, tool-governed, budget-aware, sandboxed, independently verified, and reversible where possible.