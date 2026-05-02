var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class DomainOverlayRegistry {
    constructor() {
        this.overlays = new Map();
    }
    register(registration) {
        validateManifest(registration.manifest);
        const domainId = registration.manifest.domainId;
        if (this.overlays.has(domainId)) {
            throw new Error(`DomainOverlayRegistry: duplicate domainId "${domainId}"`);
        }
        this.overlays.set(domainId, registration);
    }
    get(domainId) {
        return this.overlays.get(domainId);
    }
    list() {
        return Array.from(this.overlays.values())
            .map((registration) => registration.manifest)
            .sort((a, b) => a.domainId.localeCompare(b.domainId));
    }
    resolveToolPermissionOverrides(domainIds) {
        var _a;
        const overrides = {};
        for (const domainId of sortedUnique(domainIds)) {
            const manifest = this.require(domainId).manifest;
            Object.assign(overrides, (_a = manifest.toolPermissionOverrides) !== null && _a !== void 0 ? _a : {});
        }
        return overrides;
    }
    resolveContextFacts(domainIds_1) {
        return __awaiter(this, arguments, void 0, function* (domainIds, ctx = {}) {
            var _a, _b, _c;
            const policyFacts = [];
            const domainFacts = [];
            for (const domainId of sortedUnique(domainIds)) {
                const registration = this.require(domainId);
                const manifest = registration.manifest;
                policyFacts.push(...manifestToPolicyFacts(manifest));
                domainFacts.push(...((_a = manifest.staticDomainFacts) !== null && _a !== void 0 ? _a : []));
                if ((_b = registration.hooks) === null || _b === void 0 ? void 0 : _b.buildPolicyFacts) {
                    policyFacts.push(...yield registration.hooks.buildPolicyFacts(manifest, ctx));
                }
                if ((_c = registration.hooks) === null || _c === void 0 ? void 0 : _c.buildDomainFacts) {
                    domainFacts.push(...yield registration.hooks.buildDomainFacts(manifest, ctx));
                }
            }
            return {
                policyFacts: mergeContextFacts(policyFacts),
                domainFacts: mergeContextFacts(domainFacts),
            };
        });
    }
    enrichCompileInput(input, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const facts = yield this.resolveContextFacts(options.domainIds, Object.assign(Object.assign({}, options.context), { workspaceId: input.workspaceId, projectId: input.projectId, runId: input.runId, task: input.task }));
            return Object.assign(Object.assign({}, input), { policyFacts: mergeContextFacts([...((_a = input.policyFacts) !== null && _a !== void 0 ? _a : []), ...facts.policyFacts]), domainFacts: mergeContextFacts([...((_b = input.domainFacts) !== null && _b !== void 0 ? _b : []), ...facts.domainFacts]) });
        });
    }
    instantiateWorkflow(domainId, templateId, options = {}) {
        var _a;
        const manifest = this.require(domainId).manifest;
        const template = (_a = manifest.workflowTemplates) === null || _a === void 0 ? void 0 : _a.find((candidate) => candidate.id === templateId);
        if (!template) {
            throw new Error(`DomainOverlayRegistry: unknown workflow template "${domainId}/${templateId}"`);
        }
        return materializeWorkflowTemplate(manifest, template, options);
    }
    require(domainId) {
        const registration = this.overlays.get(domainId);
        if (!registration)
            throw new Error(`DomainOverlayRegistry: unknown domainId "${domainId}"`);
        return registration;
    }
}
export function mergeContextFacts(facts) {
    const byId = new Map();
    for (const fact of facts) {
        byId.set(fact.id, fact);
    }
    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}
export function materializeWorkflowTemplate(manifest, template, options = {}) {
    var _a;
    const prefix = (_a = options.idPrefix) !== null && _a !== void 0 ? _a : `${manifest.domainId}/${template.id}`;
    const nodeId = (id) => `${prefix}/${id}`;
    return [...template.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((node) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        return ({
            id: nodeId(node.id),
            kind: node.kind,
            payload: Object.assign(Object.assign(Object.assign({}, ((_a = node.payload) !== null && _a !== void 0 ? _a : {})), ((_b = options.payload) !== null && _b !== void 0 ? _b : {})), { domainId: manifest.domainId, templateId: template.id, taskSchemaId: template.taskSchemaId }),
            dependsOn: ((_c = node.dependsOn) !== null && _c !== void 0 ? _c : []).map(nodeId).sort(),
            idempotencyKey: `${manifest.domainId}:${template.id}:${node.id}`,
            retryClass: (_d = node.retryClass) !== null && _d !== void 0 ? _d : 'transient',
            timeoutClass: (_e = node.timeoutClass) !== null && _e !== void 0 ? _e : 'normal',
            compensation: (_f = node.compensation) !== null && _f !== void 0 ? _f : { kind: 'none' },
            provenance: [
                ...((_g = node.provenance) !== null && _g !== void 0 ? _g : []),
                ...((_h = options.provenance) !== null && _h !== void 0 ? _h : []),
                {
                    kind: 'ledger_event',
                    ref: `domain-overlay:${manifest.domainId}:${template.id}:${node.id}`,
                    role: 'input',
                    meta: { domainId: manifest.domainId, templateId: template.id },
                },
            ],
        });
    });
}
function manifestToPolicyFacts(manifest) {
    var _a, _b, _c;
    const facts = [...((_a = manifest.staticPolicyFacts) !== null && _a !== void 0 ? _a : [])];
    for (const rule of (_b = manifest.privacyRules) !== null && _b !== void 0 ? _b : []) {
        facts.push({
            id: `${manifest.domainId}:privacy:${rule.id}`,
            content: rule,
            source: {
                kind: 'policy',
                ref: `${manifest.domainId}/privacy/${rule.id}`,
                role: 'policy',
                meta: { domainId: manifest.domainId, effect: rule.effect },
            },
        });
    }
    for (const [toolName, permission] of Object.entries((_c = manifest.toolPermissionOverrides) !== null && _c !== void 0 ? _c : {})) {
        facts.push({
            id: `${manifest.domainId}:tool-permission:${toolName}`,
            content: { toolName, permission },
            source: {
                kind: 'policy',
                ref: `${manifest.domainId}/tool/${toolName}`,
                role: 'policy',
                meta: { domainId: manifest.domainId, permission },
            },
        });
    }
    return facts;
}
function validateManifest(manifest) {
    var _a, _b;
    if (manifest.schemaVersion !== 'domain_overlay.v1') {
        throw new Error(`DomainOverlayRegistry: unsupported schemaVersion "${manifest.schemaVersion}"`);
    }
    if (!manifest.domainId)
        throw new Error('DomainOverlayRegistry: manifest.domainId is required');
    if (!manifest.version)
        throw new Error('DomainOverlayRegistry: manifest.version is required');
    const nodeIds = new Set();
    for (const template of (_a = manifest.workflowTemplates) !== null && _a !== void 0 ? _a : []) {
        nodeIds.clear();
        for (const node of template.nodes) {
            if (nodeIds.has(node.id)) {
                throw new Error(`DomainOverlayRegistry: duplicate node "${node.id}" in template "${template.id}"`);
            }
            nodeIds.add(node.id);
        }
        for (const node of template.nodes) {
            for (const dep of (_b = node.dependsOn) !== null && _b !== void 0 ? _b : []) {
                if (!nodeIds.has(dep)) {
                    throw new Error(`DomainOverlayRegistry: unknown dependency "${dep}" in template "${template.id}"`);
                }
            }
        }
    }
}
function sortedUnique(values) {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
