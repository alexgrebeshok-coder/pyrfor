import { createHash } from 'node:crypto';
function nonEmptyText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function normalizeHttpUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch (_a) {
        throw new Error(`ResearchEvidence: invalid source URL: ${value}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`ResearchEvidence: source URL must use http or https: ${value}`);
    }
    parsed.hash = '';
    return parsed.toString();
}
function hashText(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function createResearchEvidenceSnapshot(runId, input, now = () => new Date()) {
    const query = nonEmptyText(input.query);
    if (!query)
        throw new Error('ResearchEvidence: query is required');
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
        throw new Error('ResearchEvidence: at least one source is required');
    }
    if (input.sources.length > 25) {
        throw new Error('ResearchEvidence: sources are limited to 25 per artifact');
    }
    const sources = input.sources.map((source) => {
        const url = nonEmptyText(source.url);
        if (!url)
            throw new Error('ResearchEvidence: source URL is required');
        return Object.assign(Object.assign(Object.assign(Object.assign({ url: normalizeHttpUrl(url) }, (nonEmptyText(source.title) ? { title: nonEmptyText(source.title) } : {})), (nonEmptyText(source.snippet) ? { snippet: nonEmptyText(source.snippet) } : {})), (nonEmptyText(source.citation) ? { citation: nonEmptyText(source.citation) } : {})), (nonEmptyText(source.observedAt) ? { observedAt: nonEmptyText(source.observedAt) } : {}));
    });
    return Object.assign(Object.assign(Object.assign({ schemaVersion: 'pyrfor.research_evidence.v1', createdAt: now().toISOString(), runId,
        query, queryHash: hashText(query), sourceMode: 'operator_supplied', effectsExecuted: [], sources }, (nonEmptyText(input.summary) ? { summary: nonEmptyText(input.summary) } : {})), (nonEmptyText(input.conclusion) ? { conclusion: nonEmptyText(input.conclusion) } : {})), { notes: (Array.isArray(input.notes) ? input.notes : []).map(nonEmptyText).filter((note) => Boolean(note)) });
}
export function createGovernedSearchResearchEvidenceSnapshot(runId, input, now = () => new Date()) {
    const query = nonEmptyText(input.query);
    if (!query)
        throw new Error('ResearchEvidence: query is required');
    const approvalId = nonEmptyText(input.approvalId);
    if (!approvalId)
        throw new Error('ResearchEvidence: approvalId is required for governed search');
    if (!Array.isArray(input.results) || input.results.length === 0) {
        throw new Error('ResearchEvidence: governed search returned no sources');
    }
    const sources = input.results.slice(0, input.maxResults).map((source) => {
        const url = nonEmptyText(source.url);
        if (!url)
            throw new Error('ResearchEvidence: source URL is required');
        return Object.assign(Object.assign(Object.assign(Object.assign({ url: normalizeHttpUrl(url) }, (nonEmptyText(source.title) ? { title: nonEmptyText(source.title) } : {})), (nonEmptyText(source.snippet) ? { snippet: nonEmptyText(source.snippet) } : {})), (nonEmptyText(source.citation) ? { citation: nonEmptyText(source.citation) } : {})), (nonEmptyText(source.observedAt) ? { observedAt: nonEmptyText(source.observedAt) } : {}));
    });
    return {
        schemaVersion: 'pyrfor.research_evidence.v2',
        createdAt: now().toISOString(),
        runId,
        query,
        queryHash: hashText(query),
        sourceMode: 'governed_search',
        effectsExecuted: [{
                kind: 'web_search',
                provider: input.provider,
                approvalId,
                executedAt: input.executedAt,
                maxResults: input.maxResults,
                resultCount: sources.length,
            }],
        sources,
        summary: `Governed ${input.provider} search captured ${sources.length} source${sources.length === 1 ? '' : 's'}.`,
        notes: (Array.isArray(input.notes) ? input.notes : []).map(nonEmptyText).filter((note) => Boolean(note)),
    };
}
