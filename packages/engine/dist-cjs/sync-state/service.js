"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDerivedSyncCheckpoint = getDerivedSyncCheckpoint;
exports.markDerivedSyncStarted = markDerivedSyncStarted;
exports.markDerivedSyncSuccess = markDerivedSyncSuccess;
exports.markDerivedSyncError = markDerivedSyncError;
const prisma_1 = require("../prisma");
const defaultDerivedSyncStore = {
    findUnique(args) {
        return prisma_1.prisma.derivedSyncState.findUnique(args);
    },
    upsert(args) {
        return prisma_1.prisma.derivedSyncState.upsert(args);
    },
};
async function getDerivedSyncCheckpoint(key, deps = {}) {
    const syncStore = deps.syncStore ?? defaultDerivedSyncStore;
    const row = await syncStore.findUnique({
        where: { key },
    });
    return row ? serializeDerivedSyncCheckpoint(row) : null;
}
async function markDerivedSyncStarted(key, deps = {}) {
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
async function markDerivedSyncSuccess(key, input, deps = {}) {
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
async function markDerivedSyncError(key, error, input = {}, deps = {}) {
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
function serializeDerivedSyncCheckpoint(row) {
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
function normalizeStatus(value) {
    switch (value) {
        case "running":
        case "success":
        case "error":
            return value;
        default:
            return "idle";
    }
}
function parseMetadata(value) {
    if (!value) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function serializeMetadata(metadata) {
    if (!metadata) {
        return null;
    }
    return JSON.stringify(metadata);
}
function formatErrorMessage(error) {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    return "Unknown sync failure.";
}
