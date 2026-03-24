// @vitest-environment node

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeBaseUrl, runPostdeploySmoke } from "@/scripts/postdeploy-smoke";

interface TestLoggerMessages {
  info: string[];
  warn: string[];
  error: string[];
}

function createTestLogger(messages: TestLoggerMessages) {
  return {
    info: (message: string) => messages.info.push(message),
    warn: (message: string) => messages.warn.push(message),
    error: (message: string) => messages.error.push(message),
  };
}

function createHtmlResponse(response: ServerResponse, body = "<html><body>CEOClaw</body></html>") {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine the test server port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

let activeServer: { close: () => Promise<void> } | null = null;

afterEach(async () => {
  if (activeServer) {
    await activeServer.close();
    activeServer = null;
  }
});

describe("post-deploy smoke runner", () => {
  it("passes for a healthy deployed surface", async () => {
    activeServer = await startServer((request, response) => {
      switch (request.url) {
        case "/api/health":
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              status: "healthy",
              checks: {
                database: { status: "connected" },
                ai: { status: "available" },
              },
            }),
          );
          return;
        case "/login":
        case "/release":
          createHtmlResponse(response);
          return;
        case "/projects":
          response.writeHead(307, {
            location: "/login?callbackUrl=%2Fprojects",
          });
          response.end();
          return;
        default:
          response.writeHead(404);
          response.end("not found");
      }
    });

    const messages: TestLoggerMessages = { info: [], warn: [], error: [] };

    await expect(
      runPostdeploySmoke({
        baseUrl: activeServer.baseUrl,
        attempts: 1,
        delayMs: 1,
        timeoutMs: 2_000,
        logger: createTestLogger(messages),
      }),
    ).resolves.toEqual({ warnings: [] });

    expect(messages.info).toContain(`[postdeploy-smoke] Target: ${activeServer.baseUrl}`);
    expect(messages.warn).toHaveLength(0);
  });

  it("surfaces degraded health as a warning without failing the smoke run", async () => {
    activeServer = await startServer((request, response) => {
      switch (request.url) {
        case "/api/health":
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              status: "degraded",
              checks: {
                database: { status: "connected" },
                ai: {
                  status: "no providers",
                  message: "No AI provider configured",
                },
              },
            }),
          );
          return;
        case "/login":
        case "/release":
          createHtmlResponse(response);
          return;
        case "/projects":
          response.writeHead(307, {
            location: "/login?callbackUrl=%2Fprojects",
          });
          response.end();
          return;
        default:
          response.writeHead(404);
          response.end("not found");
      }
    });

    const messages: TestLoggerMessages = { info: [], warn: [], error: [] };
    const result = await runPostdeploySmoke({
      baseUrl: activeServer.baseUrl,
      attempts: 1,
      delayMs: 1,
      timeoutMs: 2_000,
      logger: createTestLogger(messages),
    });

    expect(result.warnings).toEqual(["Health endpoint is degraded: No AI provider configured"]);
    expect(messages.warn).toContain("[postdeploy-smoke] Health endpoint is degraded: No AI provider configured");
  });

  it("fails when the health endpoint is unhealthy", async () => {
    activeServer = await startServer((request, response) => {
      switch (request.url) {
        case "/api/health":
          response.writeHead(503, {
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              status: "unhealthy",
              checks: {
                database: {
                  status: "error",
                  message: "Database unavailable",
                },
              },
            }),
          );
          return;
        case "/login":
        case "/release":
          createHtmlResponse(response);
          return;
        case "/projects":
          response.writeHead(307, {
            location: "/login?callbackUrl=%2Fprojects",
          });
          response.end();
          return;
        default:
          response.writeHead(404);
          response.end("not found");
      }
    });

    const messages: TestLoggerMessages = { info: [], warn: [], error: [] };

    await expect(
      runPostdeploySmoke({
        baseUrl: activeServer.baseUrl,
        attempts: 1,
        delayMs: 1,
        timeoutMs: 2_000,
        logger: createTestLogger(messages),
      }),
    ).rejects.toThrow("Health endpoint returned 503");
  });

  it("normalizes local and Vercel-style base URLs", () => {
    expect(normalizeBaseUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("ceoclaw.vercel.app")).toBe("https://ceoclaw.vercel.app");
  });
});
