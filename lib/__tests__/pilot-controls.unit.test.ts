import assert from "node:assert/strict";

import { buildAccessProfile } from "@/lib/auth/access-profile";
import {
  evaluatePilotWorkflowAccess,
  getPilotControlState,
  getPilotStageLabel,
} from "@/lib/server/pilot-controls";

const liveRuntime = {
  dataMode: "live" as const,
  databaseConfigured: true,
  healthStatus: "ok" as const,
};

function testDeliveryPilotAllowsDeliveryAiApply() {
  const accessProfile = buildAccessProfile({
    organizationSlug: "ceoclaw-demo",
    role: "PM",
    workspaceId: "delivery",
  });

  const result = evaluatePilotWorkflowAccess({
    accessProfile,
    env: {
      ...process.env,
      PILOT_ROLLOUT_STAGE: "delivery",
      PILOT_TENANT_SLUG: "ceoclaw-demo",
    },
    runtime: liveRuntime,
    workflow: "ai_apply",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.state.stage, "delivery");
  assert.equal(result.state.tenantSlug, "ceoclaw-demo");
}

function testDeliveryPilotBlocksExecutiveDelivery() {
  const accessProfile = buildAccessProfile({
    organizationSlug: "ceoclaw-demo",
    role: "EXEC",
    workspaceId: "executive",
  });

  const result = evaluatePilotWorkflowAccess({
    accessProfile,
    env: {
      ...process.env,
      PILOT_ROLLOUT_STAGE: "delivery",
      PILOT_TENANT_SLUG: "ceoclaw-demo",
    },
    runtime: liveRuntime,
    workflow: "executive_delivery",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "PILOT_STAGE_BLOCKED");
  assert.match(result.message ?? "", /Delivery-only posture blocks executive outbound sends/i);
}

function testDeliveryPilotAllowsWorkReportDelivery() {
  const accessProfile = buildAccessProfile({
    organizationSlug: "ceoclaw-demo",
    role: "PM",
    workspaceId: "delivery",
  });

  const result = evaluatePilotWorkflowAccess({
    accessProfile,
    env: {
      ...process.env,
      PILOT_ROLLOUT_STAGE: "delivery",
      PILOT_TENANT_SLUG: "ceoclaw-demo",
    },
    runtime: liveRuntime,
    workflow: "work_report_delivery",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.code, null);
}

function testPilotStateExposesReadableLabels() {
  const state = getPilotControlState(liveRuntime, {
    ...process.env,
    PILOT_ROLLOUT_STAGE: "observe",
    PILOT_TENANT_SLUG: "ceoclaw-demo",
  });

  assert.equal(state.blockedWorkflows.length, 4);
  assert.equal(getPilotStageLabel(state.stage), "Observe only");
  assert.equal(state.liveMutationAllowed, false);
}

function main() {
  testDeliveryPilotAllowsDeliveryAiApply();
  testDeliveryPilotBlocksExecutiveDelivery();
  testDeliveryPilotAllowsWorkReportDelivery();
  testPilotStateExposesReadableLabels();
  console.log("PASS pilot-controls.unit");
}

main();
