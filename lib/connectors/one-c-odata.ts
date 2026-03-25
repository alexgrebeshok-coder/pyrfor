type OneCFetch = typeof fetch;

export interface OneCODataCounterparty {
  id: string | null;
  code: string | null;
  description: string | null;
  inn: string | null;
}

export interface OneCODataReceiptDocument {
  id: string | null;
  number: string | null;
  date: string | null;
  posted: boolean | null;
  operationType: string | null;
  counterparty: string | null;
  amount: number | null;
  currency: string | null;
}

export interface OneCODataSnapshot {
  id: "one-c-odata";
  checkedAt: string;
  configured: boolean;
  status: "ok" | "pending" | "degraded";
  message: string;
  missingSecrets: string[];
  metadata?: Record<string, string | number | boolean | null>;
  sampleUrl?: string;
  counterparties: OneCODataCounterparty[];
  receipts: OneCODataReceiptDocument[];
}

export function getOneCODataUrl(env: NodeJS.ProcessEnv = process.env) {
  return env.ONE_C_ODATA_URL?.trim() || null;
}

export function getOneCODataAuth(env: NodeJS.ProcessEnv = process.env) {
  const token = env.ONE_C_ODATA_TOKEN?.trim() || null;
  const username = env.ONE_C_ODATA_USERNAME?.trim() || null;
  const password = env.ONE_C_ODATA_PASSWORD?.trim() || null;

  return {
    token,
    username,
    password,
    configured: Boolean(token || (username && password)),
  };
}

export function buildOneCODataEntityUrl(
  baseUrl: string,
  entityPath: string,
  query?: Record<string, string | number | undefined | null>
) {
  const url = new URL(baseUrl);
  const normalizedBase = url.pathname.replace(/\/$/, "");
  const normalizedEntity = entityPath.replace(/^\//, "");
  url.pathname = `${normalizedBase}/${normalizedEntity}`;

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

export async function fetchOneCODataCollection<T>(
  input: {
    baseUrl: string;
    entityPath: string;
    query?: Record<string, string | number | undefined | null>;
    env?: NodeJS.ProcessEnv;
  },
  fetchImpl: OneCFetch = fetch
): Promise<{ url: string; items: T[] }> {
  const url = buildOneCODataEntityUrl(input.baseUrl, input.entityPath, input.query);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: buildOneCODataHeaders(input.env),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`1C OData request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.value)
    ? (payload.value as T[])
    : Array.isArray(payload)
      ? (payload as T[])
      : [];

  return { url, items };
}

export async function getOneCODataSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OneCFetch = fetch
): Promise<OneCODataSnapshot> {
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
    const [counterpartiesResult, receiptsResult] = await Promise.all([
      fetchOneCODataCollection<Record<string, unknown>>(
        {
          baseUrl: baseUrl!,
          entityPath: "Catalog_Контрагенты",
          query: { $top: 5, $select: "Ref_Key,Code,Description,ИНН" },
          env,
        },
        fetchImpl
      ),
      fetchOneCODataCollection<Record<string, unknown>>(
        {
          baseUrl: baseUrl!,
          entityPath: "Document_ПоступлениеТоваровУслуг",
          query: {
            $top: 5,
            $select: "Ref_Key,Number,Date,Posted,OperationType,Контрагент,СуммаДокумента,ВалютаДокумента",
          },
          env,
        },
        fetchImpl
      ),
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
  } catch (error) {
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
}

function buildOneCODataHeaders(env: NodeJS.ProcessEnv = process.env): HeadersInit {
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

function normalizeCounterparty(input: Record<string, unknown>): OneCODataCounterparty {
  return {
    id: readString(input, ["Ref_Key", "id", "ref"]),
    code: readString(input, ["Code", "code"]),
    description: readString(input, ["Description", "description", "name"]),
    inn: readString(input, ["ИНН", "INN", "TaxId"]),
  };
}

function normalizeReceiptDocument(input: Record<string, unknown>): OneCODataReceiptDocument {
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

function readString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readBoolean(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function readNumber(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}
