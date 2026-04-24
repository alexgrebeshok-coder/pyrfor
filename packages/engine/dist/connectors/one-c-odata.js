var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function getOneCODataUrl(env = process.env) {
    var _a;
    return ((_a = env.ONE_C_ODATA_URL) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getOneCODataAuth(env = process.env) {
    var _a, _b, _c;
    const token = ((_a = env.ONE_C_ODATA_TOKEN) === null || _a === void 0 ? void 0 : _a.trim()) || null;
    const username = ((_b = env.ONE_C_ODATA_USERNAME) === null || _b === void 0 ? void 0 : _b.trim()) || null;
    const password = ((_c = env.ONE_C_ODATA_PASSWORD) === null || _c === void 0 ? void 0 : _c.trim()) || null;
    return {
        token,
        username,
        password,
        configured: Boolean(token || (username && password)),
    };
}
export function buildOneCODataEntityUrl(baseUrl, entityPath, query) {
    const url = new URL(baseUrl);
    const normalizedBase = url.pathname.replace(/\/$/, "");
    const normalizedEntity = entityPath.replace(/^\//, "");
    url.pathname = `${normalizedBase}/${normalizedEntity}`;
    for (const [key, value] of Object.entries(query !== null && query !== void 0 ? query : {})) {
        if (value === undefined || value === null || value === "")
            continue;
        url.searchParams.set(key, String(value));
    }
    return url.toString();
}
export function fetchOneCODataCollection(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, fetchImpl = fetch) {
        const url = buildOneCODataEntityUrl(input.baseUrl, input.entityPath, input.query);
        const response = yield fetchImpl(url, {
            method: "GET",
            headers: buildOneCODataHeaders(input.env),
            cache: "no-store",
        });
        if (!response.ok) {
            throw new Error(`1C OData request failed with HTTP ${response.status}`);
        }
        const payload = yield response.json();
        const items = Array.isArray(payload === null || payload === void 0 ? void 0 : payload.value)
            ? payload.value
            : Array.isArray(payload)
                ? payload
                : [];
        return { url, items };
    });
}
export function getOneCODataSnapshot() {
    return __awaiter(this, arguments, void 0, function* (env = process.env, fetchImpl = fetch) {
        const checkedAt = new Date().toISOString();
        const baseUrl = getOneCODataUrl(env);
        const auth = getOneCODataAuth(env);
        const missingSecrets = [
            ...(baseUrl ? [] : ["ONE_C_ODATA_URL"]),
            ...(auth.configured ? [] : ["ONE_C_ODATA_TOKEN or ONE_C_ODATA_USERNAME/ONE_C_ODATA_PASSWORD"]),
        ];
        if (missingSecrets.length > 0) {
            return {
                id: "one-c-odata",
                checkedAt,
                configured: false,
                status: "pending",
                message: "1C OData adapter is waiting for URL and authentication settings.",
                missingSecrets,
                counterparties: [],
                receipts: [],
            };
        }
        try {
            const [counterpartiesResult, receiptsResult] = yield Promise.all([
                fetchOneCODataCollection({
                    baseUrl: baseUrl,
                    entityPath: "Catalog_Контрагенты",
                    query: { $top: 5, $select: "Ref_Key,Code,Description,ИНН" },
                    env,
                }, fetchImpl),
                fetchOneCODataCollection({
                    baseUrl: baseUrl,
                    entityPath: "Document_ПоступлениеТоваровУслуг",
                    query: {
                        $top: 5,
                        $select: "Ref_Key,Number,Date,Posted,OperationType,Контрагент,СуммаДокумента,ВалютаДокумента",
                    },
                    env,
                }, fetchImpl),
            ]);
            return {
                id: "one-c-odata",
                checkedAt,
                configured: true,
                status: "ok",
                message: "1C OData sample read is available.",
                missingSecrets: [],
                sampleUrl: counterpartiesResult.url,
                metadata: {
                    counterpartyCount: counterpartiesResult.items.length,
                    receiptCount: receiptsResult.items.length,
                },
                counterparties: counterpartiesResult.items.map(normalizeCounterparty),
                receipts: receiptsResult.items.map(normalizeReceiptDocument),
            };
        }
        catch (error) {
            return {
                id: "one-c-odata",
                checkedAt,
                configured: true,
                status: "degraded",
                message: error instanceof Error ? error.message : "1C OData sample read failed.",
                missingSecrets: [],
                counterparties: [],
                receipts: [],
            };
        }
    });
}
function buildOneCODataHeaders(env = process.env) {
    const auth = getOneCODataAuth(env);
    if (auth.token) {
        return {
            Accept: "application/json",
            Authorization: `Bearer ${auth.token}`,
        };
    }
    if (auth.username && auth.password) {
        const basic = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
        return {
            Accept: "application/json",
            Authorization: `Basic ${basic}`,
        };
    }
    return {
        Accept: "application/json",
    };
}
function normalizeCounterparty(input) {
    return {
        id: readString(input, ["Ref_Key", "id", "ref"]),
        code: readString(input, ["Code", "code"]),
        description: readString(input, ["Description", "description", "name"]),
        inn: readString(input, ["ИНН", "INN", "TaxId"]),
    };
}
function normalizeReceiptDocument(input) {
    return {
        id: readString(input, ["Ref_Key", "id", "ref"]),
        number: readString(input, ["Number", "number"]),
        date: readString(input, ["Date", "date"]),
        posted: readBoolean(input, ["Posted", "posted"]),
        operationType: readString(input, ["OperationType", "operationType"]),
        counterparty: readString(input, ["Контрагент", "Counterparty", "counterparty"]),
        amount: readNumber(input, ["СуммаДокумента", "amount", "Amount"]),
        currency: readString(input, ["ВалютаДокумента", "currency", "Currency"]),
    };
}
function readString(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return null;
}
function readBoolean(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (typeof value === "boolean")
            return value;
    }
    return null;
}
function readNumber(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (typeof value === "number" && Number.isFinite(value))
            return value;
        if (typeof value === "string" && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return null;
}
