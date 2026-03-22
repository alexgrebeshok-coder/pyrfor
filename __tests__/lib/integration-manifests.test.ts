import assert from "node:assert/strict";
import { test } from "vitest";

import { createConnectorRegistry } from "@/lib/connectors";
import { loadConnectorManifestsFromEnv } from "@/lib/connectors/manifests";
import {
  createConfiguredAIProvider,
  loadConfiguredAIProviderManifests,
} from "@/lib/ai/provider-manifests";
import { hasAvailableProviders } from "@/lib/ai/provider-adapter";
import { AIRouter } from "@/lib/ai/providers";

type JsonResponseInput = {
  body: unknown;
  status?: number;
};

function createJsonResponse({ body, status = 200 }: JsonResponseInput): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function installFetchMock() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes("/api/auth.test")) {
      return createJsonResponse({
        body: {
          ok: true,
          team: "ops",
        },
      });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("connector manifests load and probe", async () => {
  const restoreFetch = installFetchMock();

  const connectorManifest = [
    {
      id: "slack",
      name: "Slack",
      description: "Slack workspace bridge",
      direction: "bidirectional",
      sourceSystem: "Slack Web API",
      operations: [
        "Receive workspace events",
        "Send operational notifications",
      ],
      credentials: [
        {
          envVar: "SLACK_BASE_URL",
          description: "Slack API base URL",
        },
        {
          envVar: "SLACK_BOT_TOKEN",
          description: "Bot token used for probing and outbound calls",
        },
      ],
      apiSurface: [
        {
          method: "GET",
          path: "/api/connectors/slack",
          description: "Connector status for Slack",
        },
      ],
      probe: {
        baseUrlEnvVar: "SLACK_BASE_URL",
        path: "/api/auth.test",
        authEnvVar: "SLACK_BOT_TOKEN",
        expectation: "json-field",
        responseField: "ok",
      },
    },
  ];

  const env = {
    CEOCLAW_CONNECTOR_MANIFESTS: JSON.stringify(connectorManifest),
    SLACK_BASE_URL: "https://slack.example.com",
    SLACK_BOT_TOKEN: "slack-token",
  } as unknown as NodeJS.ProcessEnv;

  try {
    const manifests = loadConnectorManifestsFromEnv(env);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.id, "slack");

    const registry = createConnectorRegistry(env);
    const slack = await registry.getStatus("slack");

    assert.ok(slack);
    assert.equal(slack?.configured, true);
    assert.equal(slack?.status, "ok");
    assert.equal(slack?.missingSecrets.length, 0);
    assert.equal(slack?.apiSurface[0]?.path, "/api/connectors/slack");
  } finally {
    restoreFetch();
  }
});

test("AI provider manifests load into router", async () => {
  const previousManifestEnv = process.env.CEOCLAW_AI_PROVIDER_MANIFESTS;
  const previousApiKey = process.env.CUSTOM_AI_API_KEY;
  const previousProviderPriority = process.env.AI_PROVIDER_PRIORITY;

  process.env.CEOCLAW_AI_PROVIDER_MANIFESTS = JSON.stringify([
    {
      name: "custom-ai",
      baseURL: "https://custom-ai.example.com/v1",
      apiKeyEnvVar: "CUSTOM_AI_API_KEY",
      defaultModel: "custom-model",
      models: ["custom-model", "custom-model-mini"],
      displayName: "Custom AI",
      description: "Manifest-driven custom AI provider",
    },
  ]);
  process.env.CUSTOM_AI_API_KEY = "custom-ai-key";
  delete process.env.AI_PROVIDER_PRIORITY;

  try {
    const manifests = loadConfiguredAIProviderManifests();
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.name, "custom-ai");

    const provider = createConfiguredAIProvider(manifests[0]!, process.env);
    assert.equal(provider.name, "custom-ai");
    assert.deepEqual(provider.models, ["custom-model", "custom-model-mini"]);

    const router = new AIRouter();
    assert.equal(router.hasProvider("custom-ai"), true);
    assert.ok(router.getAvailableProviders().includes("custom-ai"));
    assert.ok(
      router.getAvailableModels().some(
        (item) => item.provider === "custom-ai" && item.model === "custom-model"
      )
    );
    assert.equal(hasAvailableProviders(), true);
  } finally {
    if (previousManifestEnv === undefined) {
      delete process.env.CEOCLAW_AI_PROVIDER_MANIFESTS;
    } else {
      process.env.CEOCLAW_AI_PROVIDER_MANIFESTS = previousManifestEnv;
    }

    if (previousApiKey === undefined) {
      delete process.env.CUSTOM_AI_API_KEY;
    } else {
      process.env.CUSTOM_AI_API_KEY = previousApiKey;
    }

    if (previousProviderPriority === undefined) {
      delete process.env.AI_PROVIDER_PRIORITY;
    } else {
      process.env.AI_PROVIDER_PRIORITY = previousProviderPriority;
    }
  }
});
