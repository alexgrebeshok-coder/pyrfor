var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function getOneCApiUrl(env = process.env) {
    var _a;
    return ((_a = env.ONE_C_BASE_URL) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getOneCApiKey(env = process.env) {
    var _a;
    return ((_a = env.ONE_C_API_KEY) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function buildOneCSampleUrl(baseUrl, pageSize = 3) {
    const url = new URL(baseUrl);
    const normalizedPath = url.pathname.replace(/\/$/, "");
    if (!url.search) {
        if (hasExplicitSamplePath(normalizedPath)) {
            url.pathname = normalizedPath;
        }
        else if (normalizedPath.endsWith("/health") || normalizedPath.endsWith("/status")) {
            url.pathname = normalizedPath.replace(/\/(health|status)$/i, "/project-financials");
        }
        else {
            url.pathname = `${normalizedPath}/project-financials`;
        }
    }
    if (!url.searchParams.has("page_size")) {
        url.searchParams.set("page_size", String(pageSize));
    }
    return url.toString();
}
export function buildOneCProbeUrl(baseUrl) {
    return buildOneCSampleUrl(baseUrl, 1);
}
export function probeOneCApi(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, fetchImpl = fetch) {
        const probeUrl = buildOneCProbeUrl(input.baseUrl);
        const response = yield fetchImpl(probeUrl, {
            method: "GET",
            headers: buildOneCHeaders(input.apiKey),
            cache: "no-store",
        });
        const text = yield response.text();
        const parsedPayload = parseJson(text);
        if (!response.ok) {
            return {
                ok: false,
                probeUrl,
                status: response.status,
                message: `HTTP ${response.status} while calling 1C read probe`,
                metadata: {
                    probeUrl,
                    responseShape: describePayloadShape(parsedPayload),
                },
            };
        }
        if (parsedPayload === undefined || parsedPayload === null) {
            return {
                ok: false,
                probeUrl,
                message: parsedPayload === null
                    ? "1C read probe returned an empty payload."
                    : "1C read probe returned a non-JSON payload.",
                metadata: {
                    probeUrl,
                    contentLength: text.length,
                },
            };
        }
        const samples = normalizeOneCFinanceSamples(parsedPayload);
        if (samples.length === 0) {
            return {
                ok: false,
                probeUrl,
                message: "1C read probe returned JSON, but no project finance records were found.",
                metadata: {
                    probeUrl,
                    responseShape: describePayloadShape(parsedPayload),
                },
            };
        }
        const provider = readStringField(parsedPayload, ["provider", "system", "source", "vendor", "platform"]);
        const remoteStatus = inferOneCRemoteStatus(parsedPayload);
        const totals = summarizeFinanceSamples(samples);
        const pathname = new URL(probeUrl).pathname;
        return {
            ok: true,
            probeUrl,
            remoteStatus,
            message: remoteStatus === "ok"
                ? `1C read probe returned ${samples.length} project finance record${samples.length === 1 ? "" : "s"} from ${pathname}.`
                : `1C read probe returned finance data from ${pathname}, but the remote payload reported degraded health.`,
            metadata: Object.assign({ probeUrl, responseShape: describePayloadShape(parsedPayload), remoteStatus, projectCount: samples.length, totalPlannedBudget: totals.totalPlannedBudget, totalActualBudget: totals.totalActualBudget, totalPaymentsActual: totals.totalPaymentsActual }, (provider ? { provider } : {})),
        };
    });
}
export function fetchOneCFinanceSample(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, fetchImpl = fetch) {
        const sampleUrl = buildOneCSampleUrl(input.baseUrl, sanitizePageSize(input.pageSize, 3, 24));
        const response = yield fetchImpl(sampleUrl, {
            method: "GET",
            headers: buildOneCHeaders(input.apiKey),
            cache: "no-store",
        });
        const text = yield response.text();
        const parsedPayload = parseJson(text);
        if (!response.ok) {
            return {
                ok: false,
                sampleUrl,
                status: response.status,
                message: `HTTP ${response.status} while calling 1C finance sample`,
                metadata: {
                    sampleUrl,
                    responseShape: describePayloadShape(parsedPayload),
                },
            };
        }
        if (parsedPayload === undefined || parsedPayload === null) {
            return {
                ok: false,
                sampleUrl,
                message: parsedPayload === null
                    ? "1C finance sample returned an empty payload."
                    : "1C finance sample returned a non-JSON payload.",
                metadata: {
                    sampleUrl,
                    contentLength: text.length,
                },
            };
        }
        const samples = normalizeOneCFinanceSamples(parsedPayload);
        if (samples.length === 0) {
            return {
                ok: false,
                sampleUrl,
                message: "1C finance sample returned JSON, but no project finance records were found.",
                metadata: {
                    sampleUrl,
                    responseShape: describePayloadShape(parsedPayload),
                },
            };
        }
        const provider = readStringField(parsedPayload, ["provider", "system", "source", "vendor", "platform"]);
        const totals = summarizeFinanceSamples(samples);
        return {
            ok: true,
            sampleUrl,
            message: `1C finance sample returned ${samples.length} project record${samples.length === 1 ? "" : "s"} from ${new URL(sampleUrl).pathname}.`,
            samples,
            metadata: Object.assign({ sampleUrl, responseShape: describePayloadShape(parsedPayload), sampleCount: samples.length, requestedPageSize: sanitizePageSize(input.pageSize, 3, 24), totalPlannedBudget: totals.totalPlannedBudget, totalActualBudget: totals.totalActualBudget, totalPaymentsActual: totals.totalPaymentsActual }, (provider ? { provider } : {})),
        };
    });
}
export function getOneCFinanceSampleSnapshot() {
    return __awaiter(this, arguments, void 0, function* (env = process.env, fetchImpl = fetch) {
        return getOneCFinanceBaseSnapshot({
            env,
            fetchImpl,
            pageSize: 3,
        });
    });
}
export function getOneCFinanceTruthSnapshot() {
    return __awaiter(this, arguments, void 0, function* (options = {}) {
        var _a;
        const snapshot = yield getOneCFinanceBaseSnapshot({
            env: options.env,
            fetchImpl: options.fetchImpl,
            pageSize: (_a = options.pageSize) !== null && _a !== void 0 ? _a : 12,
        });
        return buildOneCFinanceTruthSnapshot(snapshot);
    });
}
export function buildOneCFinanceTruthSnapshot(snapshot) {
    const projects = buildNormalizedFinanceProjects(snapshot.samples);
    return Object.assign(Object.assign({}, snapshot), { summary: {
            projectCount: projects.length,
            overPlanCount: projects.filter((project) => project.budgetDeltaStatus === "over_plan").length,
            underPlanCount: projects.filter((project) => project.budgetDeltaStatus === "under_plan").length,
            onPlanCount: projects.filter((project) => project.budgetDeltaStatus === "on_plan").length,
            totalPlannedBudget: projects.reduce((total, project) => { var _a; return total + ((_a = project.plannedBudget) !== null && _a !== void 0 ? _a : 0); }, 0),
            totalActualBudget: projects.reduce((total, project) => { var _a; return total + ((_a = project.actualBudget) !== null && _a !== void 0 ? _a : 0); }, 0),
            totalPaymentsActual: projects.reduce((total, project) => { var _a; return total + ((_a = project.paymentsActual) !== null && _a !== void 0 ? _a : 0); }, 0),
            totalActsActual: projects.reduce((total, project) => { var _a; return total + ((_a = project.actsActual) !== null && _a !== void 0 ? _a : 0); }, 0),
            totalBudgetVariance: projects.reduce((total, project) => { var _a; return total + ((_a = project.variance) !== null && _a !== void 0 ? _a : 0); }, 0),
            totalPaymentGap: projects.reduce((total, project) => { var _a; return total + ((_a = project.paymentGap) !== null && _a !== void 0 ? _a : 0); }, 0),
            totalActGap: projects.reduce((total, project) => { var _a; return total + ((_a = project.actGap) !== null && _a !== void 0 ? _a : 0); }, 0),
        }, projects });
}
function getOneCFinanceBaseSnapshot(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const checkedAt = new Date().toISOString();
        const env = (_a = input.env) !== null && _a !== void 0 ? _a : process.env;
        const fetchImpl = (_b = input.fetchImpl) !== null && _b !== void 0 ? _b : fetch;
        const apiUrl = getOneCApiUrl(env);
        const apiKey = getOneCApiKey(env);
        const missingSecrets = [
            ...(apiUrl ? [] : ["ONE_C_BASE_URL"]),
            ...(apiKey ? [] : ["ONE_C_API_KEY"]),
        ];
        if (missingSecrets.length > 0) {
            return {
                id: "one-c",
                checkedAt,
                configured: false,
                status: "pending",
                message: "1C finance read is waiting for ONE_C_BASE_URL and ONE_C_API_KEY.",
                missingSecrets,
                samples: [],
            };
        }
        try {
            const result = yield fetchOneCFinanceSample({
                baseUrl: apiUrl,
                apiKey: apiKey,
                pageSize: input.pageSize,
            }, fetchImpl);
            if (!result.ok) {
                return {
                    id: "one-c",
                    checkedAt,
                    configured: true,
                    status: "degraded",
                    message: `1C finance read failed: ${result.message}`,
                    missingSecrets: [],
                    sampleUrl: result.sampleUrl,
                    samples: [],
                    metadata: result.metadata,
                };
            }
            return {
                id: "one-c",
                checkedAt,
                configured: true,
                status: "ok",
                message: result.message,
                missingSecrets: [],
                sampleUrl: result.sampleUrl,
                samples: result.samples,
                metadata: result.metadata,
            };
        }
        catch (error) {
            return {
                id: "one-c",
                checkedAt,
                configured: true,
                status: "degraded",
                message: error instanceof Error
                    ? `1C finance read failed: ${error.message}`
                    : "1C finance read failed with an unknown error.",
                missingSecrets: [],
                samples: [],
            };
        }
    });
}
function buildOneCHeaders(apiKey) {
    return {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
    };
}
function hasExplicitSamplePath(pathname) {
    return /\/(project-financials|financial-status|financials|budget-status|odata\/projectfinancials)$/i.test(pathname);
}
function inferOneCRemoteStatus(payload) {
    const rawStatus = readStringField(payload, ["status", "health"]);
    if (!rawStatus) {
        return "ok";
    }
    const normalized = rawStatus.trim().toLowerCase();
    return normalized.includes("degrad") || normalized.includes("error") || normalized.includes("fail")
        ? "degraded"
        : "ok";
}
function normalizeOneCFinanceSamples(payload) {
    const records = collectFinanceRecords(payload);
    const samples = [];
    for (const record of records) {
        const sample = normalizeFinanceRecord(record);
        if (sample) {
            samples.push(sample);
        }
    }
    return samples;
}
function collectFinanceRecords(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (!payload || typeof payload !== "object") {
        return [];
    }
    const record = payload;
    for (const key of ["projects", "items", "rows", "records", "results", "value", "data"]) {
        const nested = record[key];
        if (Array.isArray(nested)) {
            return nested;
        }
        if (nested && typeof nested === "object") {
            const nestedRecords = collectFinanceRecords(nested);
            if (nestedRecords.length > 0) {
                return nestedRecords;
            }
        }
    }
    return looksLikeFinanceRecord(record) ? [record] : [];
}
function looksLikeFinanceRecord(record) {
    const projectId = readStringField(record, ["project_id", "projectId", "id", "project_code", "projectCode"]);
    const projectName = readStringField(record, ["project_name", "projectName", "name", "title"]);
    const plannedBudget = readNumberField(record, ["planned_budget", "plannedBudget", "budget_plan", "budgetPlan"]);
    const actualBudget = readNumberField(record, ["actual_budget", "actualBudget", "budget_actual", "budgetActual", "budget_fact", "budgetFact"]);
    const paymentsActual = readNumberField(record, ["payments_actual", "paymentsActual", "paid_amount", "paidAmount", "payment_fact", "paymentFact"]);
    return Boolean(projectId || projectName || plannedBudget !== null || actualBudget !== null || paymentsActual !== null);
}
function normalizeFinanceRecord(record) {
    var _a;
    if (!record || typeof record !== "object") {
        return null;
    }
    const value = record;
    const projectId = readStringField(value, ["project_id", "projectId", "id", "project_code", "projectCode", "ref"]);
    const projectName = readStringField(value, ["project_name", "projectName", "name", "title"]);
    const plannedBudget = readNumberField(value, ["planned_budget", "plannedBudget", "budget_plan", "budgetPlan", "bac"]);
    const actualBudget = readNumberField(value, ["actual_budget", "actualBudget", "budget_actual", "budgetActual", "budget_fact", "budgetFact", "ac"]);
    const paymentsActual = readNumberField(value, ["payments_actual", "paymentsActual", "paid_amount", "paidAmount", "payment_fact", "paymentFact"]);
    const actsActual = readNumberField(value, ["acts_actual", "actsActual", "accepted_amount", "acceptedAmount", "closed_acts", "closedActs"]);
    const explicitVariance = readNumberField(value, ["variance", "budget_variance", "budgetVariance", "vac"]);
    const variance = explicitVariance !== null
        ? explicitVariance
        : plannedBudget !== null && actualBudget !== null
            ? plannedBudget - actualBudget
            : null;
    const explicitVariancePercent = readNumberField(value, ["variance_percent", "variancePercent", "budget_variance_ratio", "budgetVarianceRatio"]);
    const variancePercent = explicitVariancePercent !== null
        ? explicitVariancePercent
        : variance !== null && plannedBudget !== null && plannedBudget !== 0
            ? variance / plannedBudget
            : null;
    if (projectId === null &&
        projectName === null &&
        plannedBudget === null &&
        actualBudget === null &&
        paymentsActual === null &&
        actsActual === null) {
        return null;
    }
    return {
        source: "one-c",
        projectId,
        projectName,
        status: normalizeStatus((_a = readStringField(value, ["status", "project_status", "projectStatus", "state"])) !== null && _a !== void 0 ? _a : deriveFinanceStatus(variancePercent, actualBudget, paymentsActual)),
        currency: readStringField(value, ["currency", "currency_code", "currencyCode"]),
        reportDate: readStringField(value, ["report_date", "reportDate", "as_of", "asOf", "date", "period"]),
        plannedBudget,
        actualBudget,
        paymentsActual,
        actsActual,
        variance,
        variancePercent,
    };
}
function deriveFinanceStatus(variancePercent, actualBudget, paymentsActual) {
    if (variancePercent !== null && variancePercent < -0.05) {
        return "over_budget";
    }
    if ((actualBudget !== null && actualBudget !== void 0 ? actualBudget : 0) > 0 || (paymentsActual !== null && paymentsActual !== void 0 ? paymentsActual : 0) > 0) {
        return "in_progress";
    }
    return "reported";
}
function normalizeStatus(value) {
    const normalized = value.trim().toLowerCase();
    return normalized.replace(/\s+/g, "_");
}
function buildNormalizedFinanceProjects(samples) {
    return samples
        .map((sample, index) => {
        var _a, _b, _c, _d;
        const actualToPlanRatio = divideOrNull(sample.actualBudget, sample.plannedBudget);
        const paymentsToActualRatio = divideOrNull(sample.paymentsActual, sample.actualBudget);
        const actsToActualRatio = divideOrNull(sample.actsActual, sample.actualBudget);
        const variancePercent = (_a = sample.variancePercent) !== null && _a !== void 0 ? _a : divideOrNull(sample.variance, sample.plannedBudget);
        return Object.assign(Object.assign({}, sample), { projectKey: (_d = buildOneCEntityKey("project", (_c = (_b = sample.projectId) !== null && _b !== void 0 ? _b : sample.projectName) !== null && _c !== void 0 ? _c : [sample.reportDate, sample.currency, String(index)].filter(Boolean).join(":"))) !== null && _d !== void 0 ? _d : `one-c-project:${index}`, observedAt: sample.reportDate, actualToPlanRatio,
            paymentsToActualRatio,
            actsToActualRatio, paymentGap: subtractOrNull(sample.actualBudget, sample.paymentsActual), actGap: subtractOrNull(sample.actualBudget, sample.actsActual), paymentsVsActsGap: subtractOrNull(sample.paymentsActual, sample.actsActual), budgetDeltaStatus: deriveBudgetDeltaStatus(sample.variance, variancePercent) });
    })
        .sort((left, right) => {
        var _a, _b;
        const statusDiff = getBudgetStatusRank(left.budgetDeltaStatus) - getBudgetStatusRank(right.budgetDeltaStatus);
        if (statusDiff !== 0) {
            return statusDiff;
        }
        const varianceDiff = Math.abs((_a = right.variancePercent) !== null && _a !== void 0 ? _a : 0) - Math.abs((_b = left.variancePercent) !== null && _b !== void 0 ? _b : 0);
        if (varianceDiff !== 0) {
            return varianceDiff;
        }
        return compareDates(right.observedAt, left.observedAt);
    });
}
function summarizeFinanceSamples(samples) {
    return samples.reduce((accumulator, sample) => {
        var _a, _b, _c;
        accumulator.totalPlannedBudget += (_a = sample.plannedBudget) !== null && _a !== void 0 ? _a : 0;
        accumulator.totalActualBudget += (_b = sample.actualBudget) !== null && _b !== void 0 ? _b : 0;
        accumulator.totalPaymentsActual += (_c = sample.paymentsActual) !== null && _c !== void 0 ? _c : 0;
        return accumulator;
    }, {
        totalPlannedBudget: 0,
        totalActualBudget: 0,
        totalPaymentsActual: 0,
    });
}
function deriveBudgetDeltaStatus(variance, variancePercent) {
    if (variance === null && variancePercent === null) {
        return "unknown";
    }
    if ((variancePercent !== null && Math.abs(variancePercent) <= 0.02) || variance === 0) {
        return "on_plan";
    }
    if ((variance !== null && variance !== void 0 ? variance : 0) < 0) {
        return "over_plan";
    }
    return "under_plan";
}
function getBudgetStatusRank(status) {
    switch (status) {
        case "over_plan":
            return 0;
        case "under_plan":
            return 1;
        case "on_plan":
            return 2;
        case "unknown":
        default:
            return 3;
    }
}
function subtractOrNull(left, right) {
    if (left === null || right === null) {
        return null;
    }
    return left - right;
}
function divideOrNull(left, right) {
    if (left === null || right === null || right === 0) {
        return null;
    }
    return left / right;
}
function sanitizePageSize(value, fallback, max) {
    if (!Number.isFinite(value) || value === undefined) {
        return fallback;
    }
    const rounded = Math.round(value);
    if (rounded < 1) {
        return 1;
    }
    return Math.min(rounded, max);
}
function buildOneCEntityKey(prefix, value) {
    if (!value) {
        return null;
    }
    const normalized = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized ? `one-c-${prefix}:${normalized}` : null;
}
function compareDates(left, right) {
    const leftMs = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
    const rightMs = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) {
        return 0;
    }
    if (!Number.isFinite(leftMs)) {
        return -1;
    }
    if (!Number.isFinite(rightMs)) {
        return 1;
    }
    return leftMs - rightMs;
}
function readStringField(record, keys) {
    if (!record || typeof record !== "object") {
        return null;
    }
    const value = record;
    for (const key of keys) {
        const fieldValue = value[key];
        if (typeof fieldValue === "string" && fieldValue.trim()) {
            return fieldValue.trim();
        }
    }
    return null;
}
function readNumberField(record, keys) {
    if (!record || typeof record !== "object") {
        return null;
    }
    const value = record;
    for (const key of keys) {
        const fieldValue = value[key];
        if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) {
            return fieldValue;
        }
        if (typeof fieldValue === "string" && fieldValue.trim()) {
            const parsed = Number(fieldValue);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return null;
}
function describePayloadShape(payload) {
    if (Array.isArray(payload)) {
        return `array(${payload.length})`;
    }
    if (payload === null) {
        return "null";
    }
    if (payload === undefined) {
        return "non-json";
    }
    if (typeof payload === "object") {
        return `object(${Object.keys(payload).join(",")})`;
    }
    return typeof payload;
}
function parseJson(text) {
    if (!text.trim()) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch (_a) {
        return undefined;
    }
}
