import { createHash } from 'node:crypto';
export const PRODUCT_FACTORY_TEMPLATE_IDS = [
    'feature',
    'refactor',
    'bugfix',
    'bot_workflow',
    'ochag_family_reminder',
    'business_brief',
    'ui_scaffold',
];
export function isProductFactoryTemplateId(value) {
    return PRODUCT_FACTORY_TEMPLATE_IDS.includes(value);
}
function hashId(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
function cleanPrompt(prompt) {
    return prompt.trim().replace(/\s+/g, ' ');
}
function titleFromPrompt(prompt) {
    var _a;
    const cleaned = cleanPrompt(prompt);
    if (!cleaned)
        return 'Untitled product task';
    const firstSentence = (_a = cleaned.split(/[.!?]/)[0]) !== null && _a !== void 0 ? _a : cleaned;
    return firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}...` : firstSentence;
}
const CANONICAL_TEMPLATES = [
    {
        id: 'feature',
        title: 'Feature delivery',
        description: 'Turn a feature idea into a scoped implementation plan, coding DAG and delivery checklist.',
        recommendedDomainIds: [],
        clarifications: [
            { id: 'acceptance', question: 'What user-visible acceptance criteria define success?', required: true },
            { id: 'surface', question: 'Which app/API/UI surfaces are in scope?', required: true },
            { id: 'out_of_scope', question: 'What should explicitly stay out of scope?', required: false },
        ],
        deliveryArtifacts: ['implementation_summary', 'changed_files', 'tests_run', 'release_notes', 'deployment_checklist'],
        qualityGates: ['typecheck', 'focused_tests', 'build'],
    },
    {
        id: 'refactor',
        title: 'Safe refactor',
        description: 'Plan a behavior-preserving refactor with provenance and regression checks.',
        recommendedDomainIds: [],
        clarifications: [
            { id: 'target', question: 'Which module or boundary should be refactored?', required: true },
            { id: 'invariants', question: 'Which behavior must not change?', required: true },
            { id: 'migration', question: 'Is a compatibility/migration path required?', required: false },
        ],
        deliveryArtifacts: ['refactor_summary', 'changed_files', 'regression_tests', 'rollback_notes'],
        qualityGates: ['typecheck', 'regression_tests', 'build'],
    },
    {
        id: 'bugfix',
        title: 'Bug fix',
        description: 'Reproduce, fix and verify a defect with evidence.',
        recommendedDomainIds: [],
        clarifications: [
            { id: 'symptom', question: 'What exact symptom or failing command demonstrates the bug?', required: true },
            { id: 'expected', question: 'What should happen instead?', required: true },
            { id: 'scope', question: 'Which environments or users are affected?', required: false },
        ],
        deliveryArtifacts: ['root_cause', 'fix_summary', 'test_evidence', 'changed_files'],
        qualityGates: ['reproduction_check', 'focused_tests', 'build'],
    },
    {
        id: 'bot_workflow',
        title: 'Telegram/bot workflow',
        description: 'Design and implement a governed bot workflow with permissions and delivery checks.',
        recommendedDomainIds: ['ochag'],
        clarifications: [
            { id: 'audience', question: 'Who can trigger this workflow and who receives messages?', required: true },
            { id: 'trigger', question: 'What command, schedule or event starts the workflow?', required: true },
            { id: 'privacy', question: 'What private/sensitive data must be redacted or approved?', required: true },
        ],
        deliveryArtifacts: ['workflow_spec', 'bot_commands', 'privacy_checks', 'operator_runbook'],
        qualityGates: ['telegram_smoke', 'privacy_policy_check', 'focused_tests'],
    },
    {
        id: 'ochag_family_reminder',
        title: 'Ochag family reminder',
        description: 'Plan a family-scoped Telegram reminder with visibility, escalation and privacy checks.',
        recommendedDomainIds: ['ochag'],
        clarifications: [
            { id: 'familyId', question: 'Which family/workspace should own this reminder?', required: true },
            { id: 'audience', question: 'Who should receive the reminder?', required: true },
            { id: 'dueAt', question: 'When should the reminder fire?', required: true },
            { id: 'visibility', question: 'Is this member-private or family-visible?', required: true },
            { id: 'privacy', question: 'What sensitive details must be redacted or approved?', required: false },
        ],
        deliveryArtifacts: ['workflow_spec', 'privacy_checks', 'telegram_message_preview', 'family_runbook'],
        qualityGates: ['telegram_smoke', 'privacy_policy_check', 'owner_escalation_check'],
    },
    {
        id: 'business_brief',
        title: 'Business/CEO brief',
        description: 'Create an evidence-backed business brief with approvals and next actions.',
        recommendedDomainIds: ['ceoclaw'],
        clarifications: [
            { id: 'decision', question: 'What decision or approval should the brief support?', required: true },
            { id: 'evidence', question: 'Which evidence sources should be considered?', required: true },
            { id: 'projectId', question: 'Which project or business initiative is this brief for?', required: false },
            { id: 'deadline', question: 'When is the decision needed?', required: false },
        ],
        deliveryArtifacts: ['executive_summary', 'evidence_table', 'risks', 'approval_request'],
        qualityGates: ['evidence_check', 'finance_impact_check', 'approval_visibility'],
    },
    {
        id: 'ui_scaffold',
        title: 'UI scaffold',
        description: 'Plan a UI scaffold with component, state, test and visual QA steps.',
        recommendedDomainIds: [],
        clarifications: [
            { id: 'users', question: 'Who is the target user and primary job-to-be-done?', required: true },
            { id: 'states', question: 'Which loading, empty, success and error states are required?', required: true },
            { id: 'style', question: 'Which visual style or existing component conventions should be reused?', required: false },
        ],
        deliveryArtifacts: ['component_summary', 'state_matrix', 'visual_qa_notes', 'changed_files'],
        qualityGates: ['component_tests', 'build', 'browser_smoke'],
    },
];
export class ProductFactory {
    constructor() {
        this.templates = new Map(CANONICAL_TEMPLATES.map((template) => [template.id, template]));
    }
    listTemplates() {
        return [...this.templates.values()].map((template) => (Object.assign(Object.assign({}, template), { recommendedDomainIds: [...template.recommendedDomainIds], clarifications: template.clarifications.map((item) => (Object.assign({}, item))), deliveryArtifacts: [...template.deliveryArtifacts], qualityGates: [...template.qualityGates] })));
    }
    getTemplate(templateId) {
        const template = this.templates.get(templateId);
        if (!template)
            throw new Error(`Unknown product factory template "${templateId}"`);
        return this.listTemplates().find((candidate) => candidate.id === templateId);
    }
    previewPlan(input) {
        var _a, _b;
        const template = this.getTemplate(input.templateId);
        const intent = this.draftIntent(template, input);
        const missingClarifications = this.collectClarifications(template, (_a = input.answers) !== null && _a !== void 0 ? _a : {});
        const scopedPlan = this.buildScopedPlan(template, intent, (_b = input.answers) !== null && _b !== void 0 ? _b : {}, missingClarifications);
        return {
            intent,
            template,
            missingClarifications,
            scopedPlan,
            dagPreview: this.buildDagPreview(template, intent),
            deliveryChecklist: this.buildDeliveryArtifactChecklist(template),
        };
    }
    draftIntent(template, input) {
        var _a, _b;
        const goal = cleanPrompt(input.prompt);
        if (!goal)
            throw new Error('ProductFactory: prompt is required');
        const domainIds = ((_a = input.domainIds) === null || _a === void 0 ? void 0 : _a.length) ? input.domainIds : template.recommendedDomainIds;
        return {
            id: `pf-${hashId(`${template.id}:${goal}:${JSON.stringify((_b = input.answers) !== null && _b !== void 0 ? _b : {})}`)}`,
            templateId: template.id,
            title: titleFromPrompt(goal),
            goal,
            domainIds: [...domainIds],
        };
    }
    collectClarifications(template, answers) {
        return template.clarifications
            .filter((item) => { var _a; return item.required && !((_a = answers[item.id]) === null || _a === void 0 ? void 0 : _a.trim()); })
            .map((item) => (Object.assign({}, item)));
    }
    buildScopedPlan(template, intent, answers, missing) {
        const answeredScope = template.clarifications
            .filter((item) => { var _a; return (_a = answers[item.id]) === null || _a === void 0 ? void 0 : _a.trim(); })
            .map((item) => `${item.question} ${answers[item.id].trim()}`);
        return {
            objective: intent.goal,
            scope: answeredScope.length > 0
                ? answeredScope
                : [`Use the ${template.title} template to convert the idea into an executable Pyrfor run.`],
            assumptions: missing.length > 0
                ? ['Do not execute external workers until required clarifications are answered.']
                : ['Proceed under Pyrfor host authority with approvals, provenance and verifier gates enabled.'],
            risks: missing.map((item) => `Missing clarification: ${item.question}`),
            qualityGates: [...template.qualityGates],
        };
    }
    buildDagPreview(template, intent) {
        if (template.id === 'ochag_family_reminder') {
            return this.buildOchagFamilyReminderDagPreview(template, intent);
        }
        if (template.id === 'business_brief') {
            return this.buildCeoclawBusinessBriefDagPreview(template, intent);
        }
        const prefix = `product_factory/${intent.id}`;
        const basePayload = {
            productFactory: true,
            templateId: template.id,
            intentId: intent.id,
            domainIds: intent.domainIds,
        };
        return {
            nodes: [
                {
                    id: `${prefix}/clarify`,
                    kind: 'product_factory.clarify_scope',
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Collect required clarifications and confirm boundaries.' }),
                    retryClass: 'human_needed',
                    timeoutClass: 'manual',
                },
                {
                    id: `${prefix}/context`,
                    kind: 'product_factory.compile_context',
                    dependsOn: [`${prefix}/clarify`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Compile deterministic context pack and domain policy facts.' }),
                    retryClass: 'deterministic',
                },
                {
                    id: `${prefix}/plan`,
                    kind: 'product_factory.scoped_plan',
                    dependsOn: [`${prefix}/context`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Materialize scoped implementation plan and work breakdown.' }),
                    retryClass: 'deterministic',
                },
                {
                    id: `${prefix}/worker`,
                    kind: 'product_factory.worker_execution',
                    dependsOn: [`${prefix}/plan`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Route worker frames through Pyrfor host authority.' }),
                },
                {
                    id: `${prefix}/verify`,
                    kind: 'product_factory.verify',
                    dependsOn: [`${prefix}/worker`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Run verifier lane and quality gates before delivery.' }),
                    retryClass: 'policy',
                },
                {
                    id: `${prefix}/deliver`,
                    kind: 'product_factory.delivery_package',
                    dependsOn: [`${prefix}/verify`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Package summary, changed files, tests, release notes and deployment checklist.' }),
                },
            ],
        };
    }
    buildOchagFamilyReminderDagPreview(template, intent) {
        const prefix = `product_factory/${intent.id}/ochag/family-reminder`;
        const basePayload = {
            productFactory: true,
            templateId: template.id,
            intentId: intent.id,
            domainIds: intent.domainIds,
            domainId: 'ochag',
            workflowTemplateId: 'family-reminder',
            taskSchemaId: 'ochag.family_task',
        };
        return {
            nodes: [
                {
                    id: `${prefix}/classify`,
                    kind: 'ochag.classify_request',
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Classify household request, sensitivity and intended recipients.' }),
                    retryClass: 'deterministic',
                },
                {
                    id: `${prefix}/privacy-check`,
                    kind: 'ochag.privacy_check',
                    dependsOn: [`${prefix}/classify`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Verify member/family visibility and escalation approvals.' }),
                    retryClass: 'policy',
                    timeoutClass: 'manual',
                },
                {
                    id: `${prefix}/schedule`,
                    kind: 'ochag.schedule_reminder',
                    dependsOn: [`${prefix}/privacy-check`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Create reminder/routine/calendar task with escalation metadata.' }),
                },
                {
                    id: `${prefix}/notify`,
                    kind: 'ochag.telegram_notify',
                    dependsOn: [`${prefix}/schedule`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Notify allowed family members through Telegram.' }),
                },
            ],
        };
    }
    buildCeoclawBusinessBriefDagPreview(template, intent) {
        const prefix = `product_factory/${intent.id}/ceoclaw/evidence-approval`;
        const basePayload = {
            productFactory: true,
            templateId: template.id,
            intentId: intent.id,
            domainIds: intent.domainIds,
            domainId: 'ceoclaw',
            workflowTemplateId: 'evidence-approval',
            taskSchemaId: 'ceoclaw.project_action',
        };
        return {
            nodes: [
                {
                    id: `${prefix}/collect-evidence`,
                    kind: 'ceoclaw.collect_evidence',
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Collect evidence sources and decision context for the CEO brief.' }),
                },
                {
                    id: `${prefix}/verify-evidence`,
                    kind: 'ceoclaw.verify_evidence',
                    dependsOn: [`${prefix}/collect-evidence`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Verify evidence completeness and traceability.' }),
                    retryClass: 'policy',
                },
                {
                    id: `${prefix}/impact-check`,
                    kind: 'ceoclaw.finance_impact_check',
                    dependsOn: [`${prefix}/verify-evidence`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Assess finance/business impact before approval.' }),
                    retryClass: 'policy',
                },
                {
                    id: `${prefix}/approval`,
                    kind: 'ceoclaw.request_approval',
                    dependsOn: [`${prefix}/impact-check`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Request CEO/operator approval with evidence and impact notes.' }),
                    retryClass: 'human_needed',
                    timeoutClass: 'manual',
                },
                {
                    id: `${prefix}/report`,
                    kind: 'ceoclaw.generate_report',
                    dependsOn: [`${prefix}/approval`],
                    payload: Object.assign(Object.assign({}, basePayload), { goal: 'Generate executive summary, evidence table, risks and next actions.' }),
                },
            ],
        };
    }
    buildDeliveryArtifactChecklist(template) {
        return [...template.deliveryArtifacts];
    }
}
export function createDefaultProductFactory() {
    return new ProductFactory();
}
