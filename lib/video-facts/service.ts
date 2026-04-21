import { prisma } from "@/lib/prisma";
import type { EvidenceVerificationStatus } from "@/lib/evidence";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import type {
  ImageSource,
  VisionVerifyResult,
  VisionRouter,
} from "@/lib/ai/multimodal/vision";
import {
  asImageSource,
  extractKeyFrame,
  isFrameExtractionEnabled,
  looksLikeVideoUrl,
  verifyClipWithVision,
  type ExtractedFrame,
  type MultiFrameVisionResult,
} from "@/lib/ai/multimodal/frame-extractor";

import type {
  CreateVideoFactInput,
  VideoFactListResult,
  VideoFactObservationType,
  VideoFactQuery,
  VideoFactSummary,
  VideoFactView,
} from "./types";

interface VideoFactDocumentRecord {
  id: string;
  title: string;
  description: string | null;
  filename: string;
  url: string;
  type: string;
  size: number | null;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface VideoFactEvidenceRecord {
  id: string;
  sourceType: string;
  sourceRef: string | null;
  entityType: string;
  entityRef: string;
  projectId: string | null;
  title: string;
  summary: string | null;
  observedAt: Date;
  reportedAt: Date | null;
  confidence: number;
  verificationStatus: string;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface VideoFactReportRecord {
  id: string;
  reportNumber: string;
  projectId: string;
  section: string;
  reportDate: Date;
  status: string;
  project: {
    id: string;
    name: string;
  };
}

interface VideoFactDocumentStore {
  create(args: {
    data: {
      id: string;
      title: string;
      description?: string | null;
      filename: string;
      url: string;
      type: string;
      size?: number | null;
      projectId: string;
      updatedAt: Date;
    };
  }): Promise<VideoFactDocumentRecord>;
}

interface VideoFactEvidenceStore {
  create(args: {
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
  }): Promise<VideoFactEvidenceRecord>;
  findMany(args: {
    orderBy: { observedAt: "desc" };
    take: number;
    where?: {
      entityType?: string;
      projectId?: string;
    };
  }): Promise<VideoFactEvidenceRecord[]>;
}

interface VideoFactReportStore {
  findUnique(args: {
    where: { id: string };
    include: { project: { select: { id: true; name: true } } };
  }): Promise<VideoFactReportRecord | null>;
}

interface VideoFactServiceDeps {
  documentStore?: VideoFactDocumentStore;
  evidenceStore?: VideoFactEvidenceStore;
  reportStore?: VideoFactReportStore;
  /**
   * Optional vision router used to ground confidence in actual frame
   * content when the uploaded artefact is a still image or — when
   * `ENABLE_VIDEO_FRAME_EXTRACTION=true` — a short video clip whose
   * first keyframe is extracted via ffmpeg.
   */
  visionRouter?: VisionRouter | null;
  /**
   * Per-call override of whether to invoke vision verification. Defaults
   * to true when a router is available and the URL looks like an image
   * or a video (with frame extraction enabled).
   */
  enableVision?: boolean;
  /**
   * Per-call override of the ffmpeg frame extractor. Exposed mainly for
   * tests that want to stub the extractor without mutating process env.
   */
  extractFrame?: (url: string) => Promise<ExtractedFrame | null>;
  /**
   * When set to a value ≥ 2, video clips are sampled at multiple
   * offsets (via `verifyClipWithVision`) and the strongest verdict is
   * retained. Images and the single-frame path are unaffected. Overall
   * duration hint (for smarter offset selection) can be passed as
   * `videoDurationSeconds`.
   */
  multiFrameSamples?: number;
  /** Optional duration hint in seconds used by multi-frame sampling. */
  videoDurationSeconds?: number;
  /**
   * Per-call override for multi-frame verification. Supplied mainly by
   * tests that want to stub the whole video vision pipeline.
   */
  verifyVideoClip?: (
    url: string,
    claim: string,
    samples: number,
    duration: number | undefined
  ) => Promise<MultiFrameVisionResult | null>;
  now?: () => Date;
}

const defaultDocumentStore: VideoFactDocumentStore = {
  create(args) {
    return prisma.document.create(args);
  },
};

const defaultEvidenceStore: VideoFactEvidenceStore = {
  create(args) {
    return prisma.evidenceRecord.create(args);
  },
  findMany(args) {
    return prisma.evidenceRecord.findMany(args);
  },
};

const defaultReportStore: VideoFactReportStore = {
  findUnique(args) {
    return prisma.workReport.findUnique(args);
  },
};

type VerificationDecision = {
  confidence: number;
  reason: string;
  verificationStatus: EvidenceVerificationStatus;
};

export async function createVideoFact(
  input: CreateVideoFactInput,
  deps: VideoFactServiceDeps = {}
): Promise<VideoFactView> {
  const now = deps.now ?? (() => new Date());
  const documentStore = deps.documentStore ?? defaultDocumentStore;
  const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
  const reportStore = deps.reportStore ?? defaultReportStore;

  const report = await reportStore.findUnique({
    where: { id: input.reportId },
    include: {
      project: {
        select: { id: true, name: true },
      },
    },
  });

  if (!report) {
    throw new Error("Work report not found");
  }

  const capturedAt = new Date(input.capturedAt);
  const title = normalizeTitle(input.title, input.observationType, report);
  const summary = normalizeSummary(input.summary, input.observationType, report);
  const filename = buildVideoFactFilename(title, input.url, input.mimeType);

  const metadataVerification = evaluateVideoFactVerification(report, capturedAt);
  const visionOutcome = await maybeVerifyWithVision({
    url: input.url,
    mimeType: input.mimeType ?? null,
    observationType: input.observationType,
    report,
    router: deps.visionRouter,
    enabled: deps.enableVision,
    extractFrame: deps.extractFrame,
    multiFrameSamples: deps.multiFrameSamples,
    videoDurationSeconds: deps.videoDurationSeconds,
    verifyVideoClip: deps.verifyVideoClip,
  });
  const visionVerdict = visionOutcome?.verdict ?? null;
  const visionSampledFrames = visionOutcome?.sampledFrames ?? null;
  const visionPerFrameVerdicts = visionOutcome?.perFrameVerdicts ?? null;
  const verification = blendVerification(metadataVerification, visionVerdict);
  const reportedAt = now();

  const document = await documentStore.create({
    data: {
      id: randomUUID(),
      title,
      description: summary,
      filename,
      url: input.url,
      type: "video_fact",
      size: input.size ?? null,
      projectId: report.projectId,
      updatedAt: reportedAt,
    },
  });

  const evidence = await evidenceStore.create({
    data: {
      id: randomUUID(),
      sourceType: "video_document:intake",
      sourceRef: document.id,
      entityType: "video_fact",
        entityRef: document.id,
        projectId: report.projectId,
        title,
        summary,
        observedAt: capturedAt,
      reportedAt,
      confidence: verification.confidence,
      verificationStatus: verification.verificationStatus,
        metadataJson: JSON.stringify({
          documentId: document.id,
          filename: document.filename,
          projectName: report.project.name,
          reportId: report.id,
          reportNumber: report.reportNumber,
          reportStatus: report.status,
        reportDate: report.reportDate.toISOString(),
        section: report.section,
        url: input.url,
        mimeType: input.mimeType ?? null,
        size: input.size ?? null,
        observationType: input.observationType,
        verificationRule: verification.reason,
        visionVerdict: visionVerdict?.verdict ?? null,
        visionConfidence: visionVerdict?.confidence ?? null,
        visionProvider: visionVerdict?.provider ?? null,
        visionModel: visionVerdict?.model ?? null,
        visionReason: visionVerdict?.reason ?? null,
        visionSampledFrames,
        visionPerFrameVerdicts,
      }),
      updatedAt: reportedAt,
    },
  });

  return serializeVideoFactRecord(evidence);
}

export async function getVideoFactOverview(
  query: VideoFactQuery = {},
  deps: Pick<VideoFactServiceDeps, "evidenceStore" | "now"> = {}
): Promise<VideoFactListResult> {
  const now = deps.now ?? (() => new Date());
  const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
  const records = await evidenceStore.findMany({
    where: {
      entityType: "video_fact",
      ...(query.projectId ? { projectId: query.projectId } : {}),
    },
    orderBy: { observedAt: "desc" },
    take: sanitizeLimit(query.limit),
  });
  const items = records.map(serializeVideoFactRecord);

  return {
    syncedAt: now().toISOString(),
    summary: summarizeVideoFacts(items),
    items,
  };
}

function normalizeTitle(
  value: string | undefined,
  observationType: VideoFactObservationType,
  report: VideoFactReportRecord
) {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }

  return `${formatObservationType(observationType)} · ${report.reportNumber}`;
}

function normalizeSummary(
  value: string | undefined,
  observationType: VideoFactObservationType,
  report: VideoFactReportRecord
) {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }

  return `${formatObservationType(observationType)} linked to ${report.reportNumber} · ${report.section}`;
}

function buildVideoFactFilename(
  title: string,
  url: string,
  mimeType?: string | null
) {
  const safeTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const extension = resolveVideoFactExtension(url, mimeType);

  return `${safeTitle || "video-fact"}.${extension}`;
}

function resolveVideoFactExtension(url: string, mimeType?: string | null) {
  if (mimeType?.includes("/")) {
    const candidate = mimeType.split("/")[1]?.trim().toLowerCase();
    if (candidate) {
      return candidate.replace(/[^a-z0-9]+/g, "");
    }
  }

  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.trim().toLowerCase();
    if (extension && extension.length <= 8) {
      return extension.replace(/[^a-z0-9]+/g, "");
    }
  } catch {
    return "mp4";
  }

  return "mp4";
}

const IMAGE_MIME_PREFIX = "image/";
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tiff",
  "heic",
]);

function looksLikeImage(url: string, mimeType: string | null): boolean {
  if (mimeType && mimeType.toLowerCase().startsWith(IMAGE_MIME_PREFIX)) {
    return true;
  }
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
    if (ext && IMAGE_EXTENSIONS.has(ext)) {
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

function buildVisionClaim(
  observationType: VideoFactObservationType,
  report: VideoFactReportRecord
): string {
  const section = report.section ? ` at ${report.section}` : "";
  const project = report.project?.name ? ` on "${report.project.name}"` : "";
  switch (observationType) {
    case "blocked_area":
      return `This photo shows a physically blocked or cordoned-off area${section}${project}.`;
    case "idle_equipment":
      return `This photo shows construction equipment that is clearly idle or not in active operation${section}${project}.`;
    case "safety_issue":
      return `This photo shows a visible safety issue (missing PPE, unsafe conditions, or hazard)${section}${project}.`;
    case "progress_visible":
    default:
      return `This photo shows visible construction or delivery progress${section}${project}.`;
  }
}

interface MaybeVerifyWithVisionResult {
  verdict: VisionVerifyResult;
  sampledFrames: number | null;
  perFrameVerdicts: MultiFrameVisionResult["perFrameVerdicts"] | null;
}

async function maybeVerifyWithVision(params: {
  url: string;
  mimeType: string | null;
  observationType: VideoFactObservationType;
  report: VideoFactReportRecord;
  router?: VisionRouter | null;
  enabled?: boolean;
  extractFrame?: (url: string) => Promise<ExtractedFrame | null>;
  multiFrameSamples?: number;
  videoDurationSeconds?: number;
  verifyVideoClip?: (
    url: string,
    claim: string,
    samples: number,
    duration: number | undefined
  ) => Promise<MultiFrameVisionResult | null>;
}): Promise<MaybeVerifyWithVisionResult | null> {
  const {
    url,
    mimeType,
    observationType,
    report,
    router,
    enabled,
    extractFrame,
    multiFrameSamples,
    videoDurationSeconds,
    verifyVideoClip,
  } = params;

  if (enabled === false) return null;
  if (!router) return null;

  const isImage = looksLikeImage(url, mimeType);
  const isVideo = !isImage && looksLikeVideoUrl(url, mimeType);

  if (!isImage && !isVideo) return null;
  if (isVideo && !isFrameExtractionEnabled()) return null;

  const claim = buildVisionClaim(observationType, report);

  // Multi-frame path for videos when enabled via deps.
  if (isVideo && typeof multiFrameSamples === "number" && multiFrameSamples >= 2) {
    try {
      const runner =
        verifyVideoClip ??
        ((u, c, samples, duration) =>
          verifyClipWithVision(u, c, router, {
            sampleCount: samples,
            durationSeconds: duration,
          }));
      const result = await runner(url, claim, multiFrameSamples, videoDurationSeconds);
      if (!result) {
        logger.info(
          "video-facts: multi-frame extraction produced no usable frame, skipping vision",
          { reportId: report.id, url }
        );
        return null;
      }
      return {
        verdict: result.verdict,
        sampledFrames: result.sampledFrames,
        perFrameVerdicts: result.perFrameVerdicts,
      };
    } catch (err) {
      logger.warn(
        "video-facts: multi-frame vision verification failed, falling back to metadata",
        {
          reportId: report.id,
          observationType,
          error: err instanceof Error ? err.message : String(err),
        }
      );
      return null;
    }
  }

  // Single-frame path (images always; videos when multi-frame not requested).
  let image: ImageSource;
  if (isImage) {
    image = { kind: "url", url };
  } else {
    const extractor = extractFrame ?? extractKeyFrame;
    const frame = await extractor(url);
    if (!frame) {
      logger.info("video-facts: frame extraction produced no frame, skipping vision", {
        reportId: report.id,
        url,
      });
      return null;
    }
    image = asImageSource(frame);
  }

  try {
    const verdict = await router.verify(image, { claim, maxTokens: 256 });
    return {
      verdict,
      sampledFrames: isVideo ? 1 : null,
      perFrameVerdicts: null,
    };
  } catch (err) {
    logger.warn("video-facts: vision verification failed, falling back to metadata", {
      reportId: report.id,
      observationType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Blend metadata-based heuristic confidence with a vision verdict when
 * one is present. Rules:
 *   - `confirmed` → boost towards 1.0 (weighted 0.5 meta + 0.5 vision,
 *     then snap `observed` to `verified` when blended confidence ≥ 0.8).
 *   - `refuted`   → downgrade to `observed` and take min(meta, 1 - vision.conf).
 *   - `uncertain` → keep metadata verdict but nudge confidence toward
 *     0.6 · meta + 0.4 · vision.
 */
function blendVerification(
  metadata: VerificationDecision,
  vision: VisionVerifyResult | null
): VerificationDecision {
  if (!vision) return metadata;

  const visionConf = Math.max(0, Math.min(1, vision.confidence));

  if (vision.verdict === "confirmed") {
    const blended = round(metadata.confidence * 0.5 + visionConf * 0.5, 2);
    const status: EvidenceVerificationStatus =
      blended >= 0.8 ? "verified" : metadata.verificationStatus;
    return {
      verificationStatus: status as VerificationDecision["verificationStatus"],
      confidence: blended,
      reason: `${metadata.reason} Vision confirmed (${vision.provider}/${vision.model}, ${visionConf.toFixed(2)}): ${vision.reason}`.trim(),
    };
  }

  if (vision.verdict === "refuted") {
    const blended = round(Math.min(metadata.confidence, 1 - visionConf), 2);
    return {
      verificationStatus: "observed",
      confidence: Math.max(0.1, blended),
      reason: `Vision refuted (${vision.provider}/${vision.model}, ${visionConf.toFixed(2)}): ${vision.reason}. Metadata heuristic: ${metadata.reason}`,
    };
  }

  // uncertain
  const blended = round(metadata.confidence * 0.6 + visionConf * 0.4, 2);
  return {
    verificationStatus: metadata.verificationStatus,
    confidence: blended,
    reason: `${metadata.reason} Vision uncertain (${vision.provider}/${vision.model}, ${visionConf.toFixed(2)}): ${vision.reason}`.trim(),
  };
}

function evaluateVideoFactVerification(
  report: VideoFactReportRecord,
  capturedAt: Date
): VerificationDecision {
  const sameUtcDay = report.reportDate.toISOString().slice(0, 10) === capturedAt.toISOString().slice(0, 10);

  if (report.status === "approved" && sameUtcDay) {
    return {
      verificationStatus: "verified",
      confidence: 0.91,
      reason: "Linked to an approved work report from the same UTC reporting day.",
    };
  }

  if (report.status === "approved") {
    return {
      verificationStatus: "observed",
      confidence: 0.78,
      reason: "Linked to an approved work report, but capture time is outside the report day.",
    };
  }

  if (report.status === "submitted") {
    return {
      verificationStatus: "observed",
      confidence: 0.72,
      reason: "Linked to a submitted work report that is still waiting for review.",
    };
  }

  return {
    verificationStatus: "observed",
    confidence: 0.61,
    reason: "Linked report is not approved, so the visual fact remains observed only.",
  };
}

function serializeVideoFactRecord(record: VideoFactEvidenceRecord): VideoFactView {
  const metadata = parseMetadata(record.metadataJson);

  return {
    id: record.id,
    documentId: readString(metadata.documentId) ?? record.entityRef,
    reportId: readString(metadata.reportId) ?? "unknown-report",
    reportNumber: readString(metadata.reportNumber),
    reportStatus: readString(metadata.reportStatus),
    projectId: record.projectId,
    projectName: readString(metadata.projectName),
    section: readString(metadata.section),
    title: record.title,
    summary: record.summary,
    url: readString(metadata.url),
    mimeType: readString(metadata.mimeType),
    size: readNumber(metadata.size),
    observationType: normalizeObservationType(readString(metadata.observationType)),
    capturedAt: record.observedAt.toISOString(),
    reportedAt: record.reportedAt?.toISOString() ?? null,
    confidence: round(record.confidence, 2),
    verificationStatus: normalizeVerificationStatus(record.verificationStatus),
    verificationRule: readString(metadata.verificationRule),
  };
}

function summarizeVideoFacts(items: VideoFactView[]): VideoFactSummary {
  if (items.length === 0) {
    return {
      total: 0,
      observed: 0,
      verified: 0,
      averageConfidence: null,
      lastCapturedAt: null,
    };
  }

  const summary = items.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      accumulator[item.verificationStatus] += 1;
      accumulator.confidenceTotal += item.confidence;

      if (!accumulator.lastCapturedAt || accumulator.lastCapturedAt < item.capturedAt) {
        accumulator.lastCapturedAt = item.capturedAt;
      }

      return accumulator;
    },
    {
      total: 0,
      observed: 0,
      verified: 0,
      confidenceTotal: 0,
      lastCapturedAt: null as string | null,
    }
  );

  return {
    total: summary.total,
    observed: summary.observed,
    verified: summary.verified,
    averageConfidence: round(summary.confidenceTotal / summary.total, 2),
    lastCapturedAt: summary.lastCapturedAt,
  };
}

function parseMetadata(value: string | null): Record<string, string | number | boolean | null> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, string | number | boolean | null>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readString(value: string | number | boolean | null | undefined) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: string | number | boolean | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeObservationType(value: string | null): VideoFactObservationType {
  switch (value) {
    case "blocked_area":
    case "idle_equipment":
    case "safety_issue":
    case "progress_visible":
      return value;
    default:
      return "progress_visible";
  }
}

function normalizeVerificationStatus(
  value: string
): Extract<EvidenceVerificationStatus, "observed" | "verified"> {
  switch (value) {
    case "verified":
      return "verified";
    case "observed":
    default:
      return "observed";
  }
}

function sanitizeLimit(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return 6;
  }

  return Math.max(1, Math.min(Math.round(value), 24));
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatObservationType(value: VideoFactObservationType) {
  switch (value) {
    case "blocked_area":
      return "Blocked area";
    case "idle_equipment":
      return "Idle equipment";
    case "safety_issue":
      return "Safety issue";
    case "progress_visible":
    default:
      return "Progress visible";
  }
}
