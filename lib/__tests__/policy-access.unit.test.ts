import assert from "node:assert/strict";

import {
  canAccessWorkspace,
  getAvailableWorkspacesForRole,
  hasPermission,
  resolveAccessibleWorkspace,
} from "@/lib/policy/access";

function testWorkspaceVisibilityByRole() {
  assert.deepEqual(
    getAvailableWorkspacesForRole("EXEC").map((workspace) => workspace.id),
    ["executive", "delivery", "strategy"]
  );
  assert.deepEqual(
    getAvailableWorkspacesForRole("OPS").map((workspace) => workspace.id),
    ["delivery"]
  );
  assert.deepEqual(
    getAvailableWorkspacesForRole("FINANCE").map((workspace) => workspace.id),
    ["executive", "strategy"]
  );
}

function testWorkspaceResolutionFallsBackToAccessibleOption() {
  assert.equal(resolveAccessibleWorkspace("MEMBER", "executive").id, "delivery");
  assert.equal(resolveAccessibleWorkspace("FINANCE", "delivery").id, "executive");
  assert.equal(resolveAccessibleWorkspace("PM", "strategy").id, "strategy");
}

function testPermissionsStayRoleAware() {
  assert.equal(hasPermission("MEMBER", "CREATE_WORK_REPORTS"), true);
  assert.equal(hasPermission("MEMBER", "REVIEW_WORK_REPORTS"), false);
  assert.equal(hasPermission("MEMBER", "VIEW_CONNECTORS"), false);
  assert.equal(hasPermission("MEMBER", "RUN_MEETING_TO_ACTION"), false);
  assert.equal(hasPermission("MEMBER", "SEND_TELEGRAM_DIGESTS"), false);
  assert.equal(hasPermission("MEMBER", "SEND_EMAIL_DIGESTS"), false);
  assert.equal(hasPermission("MEMBER", "RUN_SCHEDULED_DIGESTS"), false);
  assert.equal(hasPermission("FINANCE", "CREATE_WORK_REPORTS"), false);
  assert.equal(hasPermission("FINANCE", "REVIEW_WORK_REPORTS"), false);
  assert.equal(hasPermission("OPS", "VIEW_EXECUTIVE_BRIEFS"), false);
  assert.equal(hasPermission("OPS", "REVIEW_WORK_REPORTS"), true);
  assert.equal(hasPermission("OPS", "RUN_MEETING_TO_ACTION"), true);
  assert.equal(hasPermission("OPS", "SEND_TELEGRAM_DIGESTS"), false);
  assert.equal(hasPermission("OPS", "SEND_EMAIL_DIGESTS"), false);
  assert.equal(hasPermission("OPS", "RUN_SCHEDULED_DIGESTS"), false);
  assert.equal(hasPermission("PM", "MANAGE_IMPORTS"), true);
  assert.equal(hasPermission("PM", "RUN_MEETING_TO_ACTION"), true);
  assert.equal(hasPermission("PM", "SEND_TELEGRAM_DIGESTS"), true);
  assert.equal(hasPermission("PM", "SEND_EMAIL_DIGESTS"), true);
  assert.equal(hasPermission("PM", "RUN_SCHEDULED_DIGESTS"), true);
  assert.equal(canAccessWorkspace("OPS", "delivery"), true);
  assert.equal(canAccessWorkspace("OPS", "executive"), false);
}

function main() {
  testWorkspaceVisibilityByRole();
  testWorkspaceResolutionFallsBackToAccessibleOption();
  testPermissionsStayRoleAware();
  console.log("PASS policy-access.unit");
}

main();
