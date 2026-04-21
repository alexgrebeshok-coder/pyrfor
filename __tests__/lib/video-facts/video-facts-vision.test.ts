import { describe, it, expect } from "vitest";
import { createVideoFact } from "@/lib/video-facts/service";
import type {
  VisionRouter,
  VisionVerifyResult,
  VisionDescribeResult,
  VisionVerifyOptions,
  ImageSource,
} from "@/lib/ai/multimodal/vision";

function fakeRouter(result: VisionVerifyResult | Error): VisionRouter {
  return {
    getAvailableProviders: () => ["mock"],
    async describe(): Promise<VisionDescribeResult> {
      return { description: "stub", provider: "mock", model: "mock" };
    },
    async verify(_image: ImageSource, _opts: VisionVerifyOptions) {
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as VisionRouter;
}

const baseReport = {
  id: "report-approved",
  reportNumber: "#20260311-approved",
  projectId: "project-1",
  section: "km 10+000",
  reportDate: new Date("2026-03-11T00:00:00.000Z"),
  status: "approved" as const,
  project: { id: "project-1", name: "Arctic Road" },
};

function makeStores() {
  const documents: unknown[] = [];
  const evidence: Array<{
    id: string;
    title: string;
    summary: string | null;
    observedAt: Date;
    reportedAt: Date | null;
    confidence: number;
    verificationStatus: string;
    metadataJson: string | null;
  }> = [];
  return {
    documents,
    evidence,
    documentStore: {
      async create(args: { data: { title: string; filename: string; url: string; type: string; projectId: string; updatedAt: Date; description?: string | null } }) {
        const doc = {
          id: `doc-${documents.length + 1}`,
          title: args.data.title,
          description: args.data.description ?? null,
          filename: args.data.filename,
          url: args.data.url,
          type: args.data.type,
          size: null,
          projectId: args.data.projectId,
          createdAt: new Date("2026-03-11T14:00:00.000Z"),
          updatedAt: args.data.updatedAt,
        };
        documents.push(doc);
        return doc;
      },
    },
    evidenceStore: {
      async create(args: {
        data: {
          id: string;
          sourceType: string;
          sourceRef?: string | null;
          entityType: string;
          entityRef: string;
          projectId?: string | null;
          title: string;
          summary?: string | null;
          observedAt: Date;
          reportedAt?: Date | null;
          confidence: number;
          verificationStatus: string;
          metadataJson?: string | null;
          updatedAt: Date;
        };
      }) {
        const rec = {
          id: `evidence-${evidence.length + 1}`,
          sourceType: args.data.sourceType,
          sourceRef: args.data.sourceRef ?? null,
          entityType: args.data.entityType,
          entityRef: args.data.entityRef,
          projectId: args.data.projectId ?? null,
          title: args.data.title,
          summary: args.data.summary ?? null,
          observedAt: args.data.observedAt,
          reportedAt: args.data.reportedAt ?? null,
          confidence: args.data.confidence,
          verificationStatus: args.data.verificationStatus,
          metadataJson: args.data.metadataJson ?? null,
          createdAt: new Date("2026-03-11T14:00:00.000Z"),
          updatedAt: args.data.updatedAt,
        };
        evidence.push(rec);
        return rec;
      },
      async findMany() {
        return [];
      },
    },
    reportStore: {
      async findUnique() {
        return baseReport;
      },
    },
  };
}

describe("video-facts vision integration", () => {
  it("skips vision for .mp4 URLs and keeps metadata verdict", async () => {
    const stores = makeStores();
    let called = false;
    const router = {
      getAvailableProviders: () => ["mock"],
      describe: async () => ({ description: "", provider: "mock", model: "mock" }),
      verify: async () => {
        called = true;
        return { verdict: "confirmed", confidence: 1, reason: "x", provider: "mock", model: "m" } as const;
      },
    } as unknown as VisionRouter;

    const fact = await createVideoFact(
      {
        reportId: "report-approved",
        url: "https://example.com/clip.mp4",
        capturedAt: "2026-03-11T08:30:00.000Z",
        observationType: "progress_visible",
      },
      {
        documentStore: stores.documentStore,
        evidenceStore: stores.evidenceStore,
        reportStore: stores.reportStore,
        visionRouter: router,
        now: () => new Date("2026-03-11T14:00:00.000Z"),
      }
    );

    expect(called).toBe(false);
    expect(fact.verificationStatus).toBe("verified");
    expect(fact.confidence).toBe(0.91);
  });

  it("invokes vision verification for image URLs and boosts confidence on confirmation", async () => {
    const stores = makeStores();
    const router = fakeRouter({
      verdict: "confirmed",
      confidence: 0.9,
      reason: "Equipment clearly visible",
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const fact = await createVideoFact(
      {
        reportId: "report-approved",
        url: "https://example.com/snapshot.jpg",
        capturedAt: "2026-03-11T08:30:00.000Z",
        observationType: "progress_visible",
        mimeType: "image/jpeg",
      },
      {
        documentStore: stores.documentStore,
        evidenceStore: stores.evidenceStore,
        reportStore: stores.reportStore,
        visionRouter: router,
        now: () => new Date("2026-03-11T14:00:00.000Z"),
      }
    );

    // 0.91 metadata + 0.9 vision → blended 0.905 ≈ 0.91, stays verified.
    expect(fact.verificationStatus).toBe("verified");
    expect(fact.confidence).toBeGreaterThanOrEqual(0.9);
    expect(fact.verificationRule).toMatch(/Vision confirmed/);
  });

  it("downgrades verdict to observed when vision refutes the claim", async () => {
    const stores = makeStores();
    const router = fakeRouter({
      verdict: "refuted",
      confidence: 0.8,
      reason: "No equipment visible; empty field",
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const fact = await createVideoFact(
      {
        reportId: "report-approved",
        url: "https://example.com/empty.png",
        capturedAt: "2026-03-11T08:30:00.000Z",
        observationType: "idle_equipment",
        mimeType: "image/png",
      },
      {
        documentStore: stores.documentStore,
        evidenceStore: stores.evidenceStore,
        reportStore: stores.reportStore,
        visionRouter: router,
        now: () => new Date("2026-03-11T14:00:00.000Z"),
      }
    );

    expect(fact.verificationStatus).toBe("observed");
    expect(fact.confidence).toBeLessThanOrEqual(0.21); // min(0.91, 1 - 0.8) = 0.2
    expect(fact.verificationRule).toMatch(/Vision refuted/);
  });

  it("falls back to metadata on vision error", async () => {
    const stores = makeStores();
    const router = fakeRouter(new Error("OpenAI vision unavailable"));

    const fact = await createVideoFact(
      {
        reportId: "report-approved",
        url: "https://example.com/ok.webp",
        capturedAt: "2026-03-11T08:30:00.000Z",
        observationType: "progress_visible",
        mimeType: "image/webp",
      },
      {
        documentStore: stores.documentStore,
        evidenceStore: stores.evidenceStore,
        reportStore: stores.reportStore,
        visionRouter: router,
        now: () => new Date("2026-03-11T14:00:00.000Z"),
      }
    );

    expect(fact.verificationStatus).toBe("verified");
    expect(fact.confidence).toBe(0.91);
  });

  it("blends uncertain verdict into confidence nudge", async () => {
    const stores = makeStores();
    const router = fakeRouter({
      verdict: "uncertain",
      confidence: 0.4,
      reason: "Image is low-resolution",
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const fact = await createVideoFact(
      {
        reportId: "report-approved",
        url: "https://example.com/blurry.jpeg",
        capturedAt: "2026-03-11T08:30:00.000Z",
        observationType: "progress_visible",
      },
      {
        documentStore: stores.documentStore,
        evidenceStore: stores.evidenceStore,
        reportStore: stores.reportStore,
        visionRouter: router,
        now: () => new Date("2026-03-11T14:00:00.000Z"),
      }
    );

    // 0.91 * 0.6 + 0.4 * 0.4 = 0.546 + 0.16 = 0.706 → rounded 0.71
    expect(fact.confidence).toBeCloseTo(0.71, 2);
    expect(fact.verificationRule).toMatch(/Vision uncertain/);
  });
});
