import { prisma } from "@/lib/prisma";

import type {
  DerivedSyncCheckpointView,
  DerivedSyncMetadata,
  DerivedSyncStatus,
} from "./types";

interface StoredDerivedSyncState {
  key: string;
  status: string;
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastResultCount: number | null;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type DerivedSyncWriteShape = {
  status: string;
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastResultCount: number | null;
  metadataJson: string | null;
  updatedAt: Date;
};

export interface DerivedSyncStore {
  findUnique(args: { where: { key: string } }): Promise<StoredDerivedSyncState | null>;
  upsert(args: {
    where: { key: string };
    create: { key: string } & DerivedSyncWriteShape;
    update: DerivedSyncWriteShape;
  }): Promise<StoredDerivedSyncState>;
}

interface DerivedSyncDeps {
  now?: () => Date;
  syncStore?: DerivedSyncStore;
}

const defaultDerivedSyncStore: DerivedSyncStore = {
  findUnique(args) {
    return prisma.derivedSyncState.findUnique(args);
  },
  upsert(args) {
    return prisma.derivedSyncState.upsert(args);
  },
};

export async function getDerivedSyncCheckpoint(
  key: string,
  deps: Pick<DerivedSyncDeps, "syncStore"> = {}
): Promise<DerivedSyncCheckpointView | null> {
  const syncStore = deps.syncStore ?? defaultDerivedSyncStore;
  const row = await syncStore.findUnique({
    where: { key },
  });

  return row ? serializeDerivedSyncCheckpoint(row) : null;
}

export async function markDerivedSyncStarted(
  key: string,
  deps: DerivedSyncDeps = {}
): Promise<DerivedSyncCheckpointView> {
  const syncStore = deps.syncStore ?? defaultDerivedSyncStore;
  const now = deps.now ?? (() => new Date());
  const timestamp = now();
  const existing = await syncStore.findUnique({
    where: { key },
  });
  const row = await syncStore.upsert({
    where: { key },
    create: {
      key,
      status: "running",
      lastStartedAt: timestamp,
      lastCompletedAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastResultCount: null,
      metadataJson: existing?.metadataJson ?? null,
      updatedAt: timestamp,
    },
    update: {
      status: "running",
      lastStartedAt: timestamp,
      lastCompletedAt: existing?.lastCompletedAt ?? null,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastError: null,
      lastResultCount: existing?.lastResultCount ?? null,
      metadataJson: existing?.metadataJson ?? null,
      updatedAt: timestamp,
    },
  });

  return serializeDerivedSyncCheckpoint(row);
}

export async function markDerivedSyncSuccess(
  key: string,
  input: {
    metadata?: DerivedSyncMetadata;
    resultCount?: number | null;
  },
  deps: DerivedSyncDeps = {}
): Promise<DerivedSyncCheckpointView> {
  const syncStore = deps.syncStore ?? defaultDerivedSyncStore;
  const now = deps.now ?? (() => new Date());
  const timestamp = now();
  const existing = await syncStore.findUnique({
    where: { key },
  });
  const row = await syncStore.upsert({
    where: { key },
    create: {
      key,
      status: "success",
      lastStartedAt: existing?.lastStartedAt ?? timestamp,
      lastCompletedAt: timestamp,
      lastSuccessAt: timestamp,
      lastError: null,
      lastResultCount: input.resultCount ?? null,
      metadataJson: serializeMetadata(input.metadata),
      updatedAt: timestamp,
    },
    update: {
      status: "success",
      lastStartedAt: existing?.lastStartedAt ?? timestamp,
      lastCompletedAt: timestamp,
      lastSuccessAt: timestamp,
      lastError: null,
      lastResultCount: input.resultCount ?? existing?.lastResultCount ?? null,
      metadataJson: serializeMetadata(input.metadata),
      updatedAt: timestamp,
    },
  });

  return serializeDerivedSyncCheckpoint(row);
}

export async function markDerivedSyncError(
  key: string,
  error: unknown,
  input: {
    metadata?: DerivedSyncMetadata;
  } = {},
  deps: DerivedSyncDeps = {}
): Promise<DerivedSyncCheckpointView> {
  const syncStore = deps.syncStore ?? defaultDerivedSyncStore;
  const now = deps.now ?? (() => new Date());
  const timestamp = now();
  const existing = await syncStore.findUnique({
    where: { key },
  });
  const row = await syncStore.upsert({
    where: { key },
    create: {
      key,
      status: "error",
      lastStartedAt: existing?.lastStartedAt ?? timestamp,
      lastCompletedAt: timestamp,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastError: formatErrorMessage(error),
      lastResultCount: existing?.lastResultCount ?? null,
      metadataJson: serializeMetadata(input.metadata) ?? existing?.metadataJson ?? null,
      updatedAt: timestamp,
    },
    update: {
      status: "error",
      lastStartedAt: existing?.lastStartedAt ?? timestamp,
      lastCompletedAt: timestamp,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastError: formatErrorMessage(error),
      lastResultCount: existing?.lastResultCount ?? null,
      metadataJson: serializeMetadata(input.metadata) ?? existing?.metadataJson ?? null,
      updatedAt: timestamp,
    },
  });

  return serializeDerivedSyncCheckpoint(row);
}

function serializeDerivedSyncCheckpoint(
  row: StoredDerivedSyncState
): DerivedSyncCheckpointView {
  return {
    key: row.key,
    status: normalizeStatus(row.status),
    lastStartedAt: row.lastStartedAt?.toISOString() ?? null,
    lastCompletedAt: row.lastCompletedAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastError: row.lastError,
    lastResultCount: row.lastResultCount,
    metadata: parseMetadata(row.metadataJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeStatus(value: string): DerivedSyncStatus {
  switch (value) {
    case "running":
    case "success":
    case "error":
      return value;
    default:
      return "idle";
  }
}

function parseMetadata(value: string | null): DerivedSyncMetadata {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as DerivedSyncMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function serializeMetadata(metadata: DerivedSyncMetadata | undefined) {
  if (!metadata) {
    return null;
  }

  return JSON.stringify(metadata);
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Unknown sync failure.";
}
