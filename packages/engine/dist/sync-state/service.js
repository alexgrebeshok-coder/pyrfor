var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma.js';
const defaultDerivedSyncStore = {
    findUnique(args) {
        return prisma.derivedSyncState.findUnique(args);
    },
    upsert(args) {
        return prisma.derivedSyncState.upsert(args);
    },
};
export function getDerivedSyncCheckpoint(key_1) {
    return __awaiter(this, arguments, void 0, function* (key, deps = {}) {
        var _a;
        const syncStore = (_a = deps.syncStore) !== null && _a !== void 0 ? _a : defaultDerivedSyncStore;
        const row = yield syncStore.findUnique({
            where: { key },
        });
        return row ? serializeDerivedSyncCheckpoint(row) : null;
    });
}
export function markDerivedSyncStarted(key_1) {
    return __awaiter(this, arguments, void 0, function* (key, deps = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        const syncStore = (_a = deps.syncStore) !== null && _a !== void 0 ? _a : defaultDerivedSyncStore;
        const now = (_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date());
        const timestamp = now();
        const existing = yield syncStore.findUnique({
            where: { key },
        });
        const row = yield syncStore.upsert({
            where: { key },
            create: {
                key,
                status: "running",
                lastStartedAt: timestamp,
                lastCompletedAt: null,
                lastSuccessAt: null,
                lastError: null,
                lastResultCount: null,
                metadataJson: (_c = existing === null || existing === void 0 ? void 0 : existing.metadataJson) !== null && _c !== void 0 ? _c : null,
                updatedAt: timestamp,
            },
            update: {
                status: "running",
                lastStartedAt: timestamp,
                lastCompletedAt: (_d = existing === null || existing === void 0 ? void 0 : existing.lastCompletedAt) !== null && _d !== void 0 ? _d : null,
                lastSuccessAt: (_e = existing === null || existing === void 0 ? void 0 : existing.lastSuccessAt) !== null && _e !== void 0 ? _e : null,
                lastError: null,
                lastResultCount: (_f = existing === null || existing === void 0 ? void 0 : existing.lastResultCount) !== null && _f !== void 0 ? _f : null,
                metadataJson: (_g = existing === null || existing === void 0 ? void 0 : existing.metadataJson) !== null && _g !== void 0 ? _g : null,
                updatedAt: timestamp,
            },
        });
        return serializeDerivedSyncCheckpoint(row);
    });
}
export function markDerivedSyncSuccess(key_1, input_1) {
    return __awaiter(this, arguments, void 0, function* (key, input, deps = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        const syncStore = (_a = deps.syncStore) !== null && _a !== void 0 ? _a : defaultDerivedSyncStore;
        const now = (_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date());
        const timestamp = now();
        const existing = yield syncStore.findUnique({
            where: { key },
        });
        const row = yield syncStore.upsert({
            where: { key },
            create: {
                key,
                status: "success",
                lastStartedAt: (_c = existing === null || existing === void 0 ? void 0 : existing.lastStartedAt) !== null && _c !== void 0 ? _c : timestamp,
                lastCompletedAt: timestamp,
                lastSuccessAt: timestamp,
                lastError: null,
                lastResultCount: (_d = input.resultCount) !== null && _d !== void 0 ? _d : null,
                metadataJson: serializeMetadata(input.metadata),
                updatedAt: timestamp,
            },
            update: {
                status: "success",
                lastStartedAt: (_e = existing === null || existing === void 0 ? void 0 : existing.lastStartedAt) !== null && _e !== void 0 ? _e : timestamp,
                lastCompletedAt: timestamp,
                lastSuccessAt: timestamp,
                lastError: null,
                lastResultCount: (_g = (_f = input.resultCount) !== null && _f !== void 0 ? _f : existing === null || existing === void 0 ? void 0 : existing.lastResultCount) !== null && _g !== void 0 ? _g : null,
                metadataJson: serializeMetadata(input.metadata),
                updatedAt: timestamp,
            },
        });
        return serializeDerivedSyncCheckpoint(row);
    });
}
export function markDerivedSyncError(key_1, error_1) {
    return __awaiter(this, arguments, void 0, function* (key, error, input = {}, deps = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const syncStore = (_a = deps.syncStore) !== null && _a !== void 0 ? _a : defaultDerivedSyncStore;
        const now = (_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date());
        const timestamp = now();
        const existing = yield syncStore.findUnique({
            where: { key },
        });
        const row = yield syncStore.upsert({
            where: { key },
            create: {
                key,
                status: "error",
                lastStartedAt: (_c = existing === null || existing === void 0 ? void 0 : existing.lastStartedAt) !== null && _c !== void 0 ? _c : timestamp,
                lastCompletedAt: timestamp,
                lastSuccessAt: (_d = existing === null || existing === void 0 ? void 0 : existing.lastSuccessAt) !== null && _d !== void 0 ? _d : null,
                lastError: formatErrorMessage(error),
                lastResultCount: (_e = existing === null || existing === void 0 ? void 0 : existing.lastResultCount) !== null && _e !== void 0 ? _e : null,
                metadataJson: (_g = (_f = serializeMetadata(input.metadata)) !== null && _f !== void 0 ? _f : existing === null || existing === void 0 ? void 0 : existing.metadataJson) !== null && _g !== void 0 ? _g : null,
                updatedAt: timestamp,
            },
            update: {
                status: "error",
                lastStartedAt: (_h = existing === null || existing === void 0 ? void 0 : existing.lastStartedAt) !== null && _h !== void 0 ? _h : timestamp,
                lastCompletedAt: timestamp,
                lastSuccessAt: (_j = existing === null || existing === void 0 ? void 0 : existing.lastSuccessAt) !== null && _j !== void 0 ? _j : null,
                lastError: formatErrorMessage(error),
                lastResultCount: (_k = existing === null || existing === void 0 ? void 0 : existing.lastResultCount) !== null && _k !== void 0 ? _k : null,
                metadataJson: (_m = (_l = serializeMetadata(input.metadata)) !== null && _l !== void 0 ? _l : existing === null || existing === void 0 ? void 0 : existing.metadataJson) !== null && _m !== void 0 ? _m : null,
                updatedAt: timestamp,
            },
        });
        return serializeDerivedSyncCheckpoint(row);
    });
}
function serializeDerivedSyncCheckpoint(row) {
    var _a, _b, _c, _d, _e, _f;
    return {
        key: row.key,
        status: normalizeStatus(row.status),
        lastStartedAt: (_b = (_a = row.lastStartedAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
        lastCompletedAt: (_d = (_c = row.lastCompletedAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : null,
        lastSuccessAt: (_f = (_e = row.lastSuccessAt) === null || _e === void 0 ? void 0 : _e.toISOString()) !== null && _f !== void 0 ? _f : null,
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
    catch (_a) {
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
