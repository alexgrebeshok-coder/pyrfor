export function normalizeChatFacts(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((fact) => normalizeChatFact(fact))
        .filter((fact) => fact !== null)
        .slice(0, 4);
}
export function normalizeChatConfidence(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const candidate = value;
    const score = normalizeScore(candidate.score);
    const band = normalizeBand(candidate.band);
    const label = normalizeString(candidate.label);
    const rationale = normalizeString(candidate.rationale);
    if (score === null || !band || !label || !rationale) {
        return undefined;
    }
    const basis = Array.isArray(candidate.basis)
        ? candidate.basis
            .map((item) => normalizeString(item))
            .filter((item) => Boolean(item))
            .slice(0, 4)
        : [];
    return {
        score,
        band,
        label,
        rationale,
        basis,
    };
}
function normalizeChatFact(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const candidate = value;
    const label = normalizeString(candidate.label);
    const text = normalizeString(candidate.value);
    if (!label || !text) {
        return null;
    }
    const fact = {
        label,
        value: text,
    };
    const href = normalizeString(candidate.href);
    if (href) {
        fact.href = href;
    }
    const meta = normalizeString(candidate.meta);
    if (meta) {
        fact.meta = meta;
    }
    return fact;
}
function normalizeBand(value) {
    return value === "low" || value === "medium" || value === "high" || value === "strong"
        ? value
        : null;
}
function normalizeScore(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}
function normalizeString(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
