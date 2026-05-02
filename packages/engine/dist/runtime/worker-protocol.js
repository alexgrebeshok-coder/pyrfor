/**
 * worker-protocol.ts — typed Worker Protocol v2 frames.
 *
 * Workers must emit these frames instead of performing effects directly. The
 * engine validates each frame before policy, approval, execution, QA, or audit
 * logic can consume it.
 */
export const WORKER_PROTOCOL_VERSION = 'wp.v2';
export class WorkerProtocolValidationError extends Error {
    constructor(errors) {
        super(errors.map((err) => `${err.path}: ${err.message}`).join('; '));
        this.name = 'WorkerProtocolValidationError';
        this.errors = errors;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
const WORKER_FRAME_TYPES = new Set([
    'plan_fragment',
    'proposed_patch',
    'proposed_command',
    'request_capability',
    'checkpoint',
    'heartbeat',
    'artifact_reference',
    'warning',
    'final_report',
    'failure_report',
]);
const FAILURE_STATUSES = new Set([
    'failed',
    'policy_blocked',
    'timed_out',
    'cancelled',
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function isWorkerFrameType(value) {
    return typeof value === 'string' && WORKER_FRAME_TYPES.has(value);
}
function isIsoDate(value) {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}
function requireString(record, key, errors) {
    if (typeof record[key] !== 'string' || record[key].length === 0) {
        errors.push({ path: key, message: 'must be a non-empty string' });
    }
}
function requireRecord(record, key, errors) {
    if (!isRecord(record[key])) {
        errors.push({ path: key, message: 'must be an object' });
    }
}
function validateBase(record) {
    const errors = [];
    if (record['protocol_version'] !== WORKER_PROTOCOL_VERSION) {
        errors.push({ path: 'protocol_version', message: `must be ${WORKER_PROTOCOL_VERSION}` });
    }
    if (!isWorkerFrameType(record['type'])) {
        errors.push({ path: 'type', message: 'must be a supported worker frame type' });
    }
    requireString(record, 'frame_id', errors);
    requireString(record, 'task_id', errors);
    requireString(record, 'run_id', errors);
    if (typeof record['seq'] !== 'number' || !Number.isInteger(record['seq']) || record['seq'] < 0) {
        errors.push({ path: 'seq', message: 'must be a non-negative integer' });
    }
    if (record['ts'] !== undefined && (typeof record['ts'] !== 'string' || !isIsoDate(record['ts']))) {
        errors.push({ path: 'ts', message: 'must be an ISO-8601 timestamp' });
    }
    if (record['trace_id'] !== undefined && typeof record['trace_id'] !== 'string') {
        errors.push({ path: 'trace_id', message: 'must be a string' });
    }
    if (record['worker_run_id'] !== undefined && typeof record['worker_run_id'] !== 'string') {
        errors.push({ path: 'worker_run_id', message: 'must be a string' });
    }
    return errors;
}
function validateFrameSpecific(record) {
    const errors = [];
    const type = record['type'];
    switch (type) {
        case 'plan_fragment':
            requireString(record, 'content', errors);
            if (record['steps'] !== undefined && !isStringArray(record['steps'])) {
                errors.push({ path: 'steps', message: 'must be an array of strings' });
            }
            break;
        case 'proposed_patch':
            requireString(record, 'patch', errors);
            if (!isStringArray(record['files']) || record['files'].length === 0) {
                errors.push({ path: 'files', message: 'must be a non-empty array of strings' });
            }
            if (record['summary'] !== undefined && typeof record['summary'] !== 'string') {
                errors.push({ path: 'summary', message: 'must be a string' });
            }
            break;
        case 'proposed_command':
            requireString(record, 'command', errors);
            if (record['cwd'] !== undefined && typeof record['cwd'] !== 'string') {
                errors.push({ path: 'cwd', message: 'must be a string' });
            }
            if (record['reason'] !== undefined && typeof record['reason'] !== 'string') {
                errors.push({ path: 'reason', message: 'must be a string' });
            }
            break;
        case 'request_capability':
            requireString(record, 'capability', errors);
            requireString(record, 'reason', errors);
            if (record['scope'] !== undefined && !isRecord(record['scope'])) {
                errors.push({ path: 'scope', message: 'must be an object' });
            }
            break;
        case 'checkpoint':
            requireString(record, 'checkpoint_id', errors);
            if (record['resume_token'] !== undefined && typeof record['resume_token'] !== 'string') {
                errors.push({ path: 'resume_token', message: 'must be a string' });
            }
            if (record['state'] !== undefined && !isRecord(record['state'])) {
                errors.push({ path: 'state', message: 'must be an object' });
            }
            break;
        case 'heartbeat':
            if (record['state'] !== undefined && typeof record['state'] !== 'string') {
                errors.push({ path: 'state', message: 'must be a string' });
            }
            if (record['progress'] !== undefined
                && (typeof record['progress'] !== 'number' || record['progress'] < 0 || record['progress'] > 1)) {
                errors.push({ path: 'progress', message: 'must be a number between 0 and 1' });
            }
            if (record['message'] !== undefined && typeof record['message'] !== 'string') {
                errors.push({ path: 'message', message: 'must be a string' });
            }
            break;
        case 'artifact_reference':
            requireString(record, 'artifact_id', errors);
            if (record['kind'] !== undefined && typeof record['kind'] !== 'string') {
                errors.push({ path: 'kind', message: 'must be a string' });
            }
            if (record['uri'] !== undefined && typeof record['uri'] !== 'string') {
                errors.push({ path: 'uri', message: 'must be a string' });
            }
            if (record['sha256'] !== undefined && typeof record['sha256'] !== 'string') {
                errors.push({ path: 'sha256', message: 'must be a string' });
            }
            break;
        case 'warning':
            requireString(record, 'code', errors);
            requireString(record, 'message', errors);
            if (record['severity'] !== undefined
                && record['severity'] !== 'low'
                && record['severity'] !== 'medium'
                && record['severity'] !== 'high') {
                errors.push({ path: 'severity', message: 'must be low, medium, or high' });
            }
            break;
        case 'final_report':
            if (record['status'] !== 'succeeded') {
                errors.push({ path: 'status', message: 'must be succeeded' });
            }
            requireString(record, 'summary', errors);
            if (record['artifacts'] !== undefined && !Array.isArray(record['artifacts'])) {
                errors.push({ path: 'artifacts', message: 'must be an array' });
            }
            if (record['verification'] !== undefined && !isRecord(record['verification'])) {
                errors.push({ path: 'verification', message: 'must be an object' });
            }
            break;
        case 'failure_report':
            if (typeof record['status'] !== 'string' || !FAILURE_STATUSES.has(record['status'])) {
                errors.push({ path: 'status', message: 'must be failed, policy_blocked, timed_out, or cancelled' });
            }
            requireRecord(record, 'error', errors);
            if (isRecord(record['error'])) {
                requireString(record['error'], 'code', errors);
                errors.push(...validateNestedString(record['error'], 'message', 'error.message'));
                if (record['error']['retryable'] !== undefined && typeof record['error']['retryable'] !== 'boolean') {
                    errors.push({ path: 'error.retryable', message: 'must be a boolean' });
                }
                if (record['error']['details'] !== undefined && !isRecord(record['error']['details'])) {
                    errors.push({ path: 'error.details', message: 'must be an object' });
                }
            }
            if (record['resume_token'] !== undefined && typeof record['resume_token'] !== 'string') {
                errors.push({ path: 'resume_token', message: 'must be a string' });
            }
            break;
        default:
            break;
    }
    return errors;
}
function validateNestedString(record, key, path) {
    return typeof record[key] === 'string' && record[key].length > 0
        ? []
        : [{ path, message: 'must be a non-empty string' }];
}
export function validateWorkerFrame(input) {
    if (!isRecord(input)) {
        return { ok: false, errors: [{ path: '$', message: 'must be an object' }] };
    }
    const errors = [...validateBase(input), ...validateFrameSpecific(input)];
    if (errors.length > 0)
        return { ok: false, errors };
    return { ok: true, frame: input };
}
export function parseWorkerFrame(input) {
    const result = validateWorkerFrame(input);
    if (!result.ok)
        throw new WorkerProtocolValidationError(result.errors);
    return result.frame;
}
export function isWorkerFrame(input) {
    return validateWorkerFrame(input).ok;
}
