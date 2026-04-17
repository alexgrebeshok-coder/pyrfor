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
  const previousE2EAuthBypass = process.env.CEOCLAW_E2E_AUTH_BYPASS;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    setGetSessionForTests(null);
    Reflect.deleteProperty(process.env, "CEOCLAW_SKIP_AUTH");
    Reflect.deleteProperty(process.env, "CEOCLAW_E2E_AUTH_BYPASS");
    Reflect.deleteProperty(process.env, "VERCEL_ENV");
    Object.assign(process.env, { NODE_ENV: "test" });
  });

  afterEach(() => {
    setGetSessionForTests(null);

    if (previousSkipAuth === undefined) {
      Reflect.deleteProperty(process.env, "CEOCLAW_SKIP_AUTH");
    } else {
      Object.assign(process.env, { CEOCLAW_SKIP_AUTH: previousSkipAuth });
    }

    if (previousE2EAuthBypass === undefined) {
      Reflect.deleteProperty(process.env, "CEOCLAW_E2E_AUTH_BYPASS");
    } else {
      Object.assign(process.env, { CEOCLAW_E2E_AUTH_BYPASS: previousE2EAuthBypass });
    }

    if (previousNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      Object.assign(process.env, { NODE_ENV: previousNodeEnv });
    }

    if (previousVercelEnv === undefined) {
      Reflect.deleteProperty(process.env, "VERCEL_ENV");
    } else {
      Object.assign(process.env, { VERCEL_ENV: previousVercelEnv });
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

  it("allows preview GET requests without a session when skip auth is enabled", async () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      CEOCLAW_SKIP_AUTH: "true",
    });
    setGetSessionForTests(async () => null);

    const result = await authorizeRequest(
      createRequest("https://preview.example/api/tasks")
    );

    expect(result instanceof NextResponse).toBe(false);
  });

  it("keeps preview write requests protected even when skip auth is enabled", async () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      CEOCLAW_SKIP_AUTH: "true",
    });
    setGetSessionForTests(async () => null);

    const result = await authorizeRequest(
      createRequest("https://preview.example/api/tasks", {
        method: "POST",
      })
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

  it("skips rate limiting when e2e auth bypass is enabled", async () => {
    Object.assign(process.env, {
      CEOCLAW_SKIP_AUTH: "true",
      CEOCLAW_E2E_AUTH_BYPASS: "true",
    });

    const results = await Promise.all(
      Array.from({ length: 105 }, (_, index) =>
        authorizeRequest(
          createRequest(`http://localhost/api/projects?attempt=${index}`, {
            headers: {
              "x-real-ip": "203.0.113.25",
            },
          })
        )
      )
    );

    expect(results.every((result) => !(result instanceof NextResponse))).toBe(true);
  });
});
