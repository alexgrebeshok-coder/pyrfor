import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { setGetSessionForTests } from "@/lib/auth/get-session";

function createRequest(url: string, init?: RequestInit) {
  return new NextRequest(new Request(url, init));
}

function buildSession(role: "EXEC" | "MEMBER", workspaceId: "executive" | "delivery") {
  return {
    user: {
      id: `${role.toLowerCase()}-user`,
      name: `${role} User`,
      role,
      workspaceId,
    },
  };
}

describe("API Authentication", () => {
  const previousSkipAuth = process.env.CEOCLAW_SKIP_AUTH;

  beforeEach(() => {
    setGetSessionForTests(null);
    delete process.env.CEOCLAW_SKIP_AUTH;
  });

  afterEach(() => {
    setGetSessionForTests(null);

    if (previousSkipAuth === undefined) {
      delete process.env.CEOCLAW_SKIP_AUTH;
    } else {
      process.env.CEOCLAW_SKIP_AUTH = previousSkipAuth;
    }
  });

  it("returns 401 when no session is available", async () => {
    setGetSessionForTests(async () => null);

    const result = await authorizeRequest(
      createRequest("http://localhost/api/projects")
    );

    expect(result instanceof NextResponse).toBe(true);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(401);
      const body = (await result.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(body.error?.code).toBe("UNAUTHORIZED");
    }
  });

  it("builds an access profile for an EXEC user", async () => {
    setGetSessionForTests(async () => buildSession("EXEC", "executive") as never);

    const result = await authorizeRequest(
      createRequest("http://localhost/api/ai/chat"),
      {
        permission: "VIEW_EXECUTIVE_BRIEFS",
        workspaceId: "executive",
      }
    );

    expect(result instanceof NextResponse).toBe(false);
    if (!(result instanceof NextResponse)) {
      expect(result.accessProfile.userId).toBe("exec-user");
      expect(result.accessProfile.role).toBe("EXEC");
      expect(result.workspace.id).toBe("executive");
    }
  });

  it("denies AI actions for MEMBER users", async () => {
    setGetSessionForTests(async () => buildSession("MEMBER", "delivery") as never);

    const result = await authorizeRequest(
      createRequest("http://localhost/api/ai/chat"),
      {
        permission: "RUN_AI_ACTIONS",
        workspaceId: "delivery",
      }
    );

    expect(result instanceof NextResponse).toBe(true);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(403);
      const body = (await result.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(body.error?.code).toBe("PERMISSION_DENIED");
    }
  });
});
