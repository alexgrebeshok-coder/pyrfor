import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { setGetSessionForTests } from "@/lib/auth/get-session";

function createRequest(url: string, init?: RequestInit) {
  return new NextRequest(new Request(url, init));
}

async function testPermissionDenial() {
  setGetSessionForTests(async () => ({
    user: {
      id: "member-1",
      name: "Member One",
      role: "MEMBER",
      workspaceId: "delivery",
    },
  } as never));

  const request = createRequest("http://localhost/api/briefs/portfolio", {
    headers: {
      "x-ceoclaw-role": "MEMBER",
    },
  });

  const result = await authorizeRequest(request, {
    permission: "VIEW_EXECUTIVE_BRIEFS",
    workspaceId: "executive",
  });

  assert.equal(result instanceof Response, true);
  if (result instanceof Response) {
    assert.equal(result.status, 403);
  }

  setGetSessionForTests(null);
}

async function testWorkspaceAndProfileResolution() {
  setGetSessionForTests(async () => ({
    user: {
      id: "ops-1",
      name: "Ops Reviewer",
      role: "OPS",
      workspaceId: "delivery",
    },
  } as never));

  const request = createRequest("http://localhost/api/work-reports?workspaceId=delivery", {
    headers: {
      "x-ceoclaw-role": "OPS",
      "x-ceoclaw-user-id": "ops-1",
      "x-ceoclaw-user-name": "Ops Reviewer",
    },
  });

  const result = await authorizeRequest(request, {
    permission: "REVIEW_WORK_REPORTS",
    workspaceId: "delivery",
  });

  assert.equal(result instanceof Response, false);
  if (!(result instanceof Response)) {
    assert.equal(result.accessProfile.userId, "ops-1");
    assert.equal(result.accessProfile.role, "OPS");
    assert.equal(result.workspace.id, "delivery");
  }

  setGetSessionForTests(null);
}

async function testApiKeyRequirement() {
  setGetSessionForTests(null);

  const previousApiKey = process.env.DASHBOARD_API_KEY;
  process.env.DASHBOARD_API_KEY = "cron-token";

  try {
    const request = createRequest("http://localhost/api/notifications/check-due-dates", {
      method: "POST",
      headers: {
        authorization: "Bearer cron-token",
        "x-ceoclaw-role": "PM",
      },
    });

    const result = await authorizeRequest(request, {
      apiKey: "cron-token",
      permission: "RUN_DUE_DATE_SCAN",
      requireApiKey: true,
      workspaceId: "executive",
    });

    assert.equal(result instanceof Response, false);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.DASHBOARD_API_KEY;
    } else {
      process.env.DASHBOARD_API_KEY = previousApiKey;
    }
  }
}

async function main() {
  try {
    await testPermissionDenial();
    await testWorkspaceAndProfileResolution();
    await testApiKeyRequirement();
    console.log("PASS policy-middleware.unit");
  } finally {
    setGetSessionForTests(null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
