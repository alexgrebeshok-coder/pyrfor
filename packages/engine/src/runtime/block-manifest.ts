import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const BLOCK_MANIFEST_VERSION = '1';
export const BLOCK_MANIFEST_FILENAME = 'block.json';

export type BlockRuntimeMode = 'trusted-core' | 'local-worker' | 'wasm' | 'container' | 'remote';
export type BlockSandbox = 'none' | 'process-isolated' | 'wasm-wasi' | 'container-oci';
export type BlockCertificationState = 'dev' | 'internal' | 'pilot' | 'certified' | 'revoked';
export type BlockPanelSlot = 'left' | 'center' | 'right' | 'bottom' | 'modal' | 'sidebar';

export interface BlockCapability {
  token: string;
  reason: string;
  scope?: 'project' | 'block' | 'global' | string;
  expires_after_run?: boolean;
}

export interface BlockContractRef {
  ref: string;
  from?: string;
  optional?: boolean;
}

export interface BlockPanel {
  id: string;
  slot: BlockPanelSlot;
  label: string;
  entry: string;
  requires_capabilities?: string[];
}

export interface BlockManifest {
  $schema?: string;
  pyrfor_manifest_version: typeof BLOCK_MANIFEST_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  runtime: {
    mode: BlockRuntimeMode;
    engine_version_range: string;
    node_version_range?: string;
    sandbox: BlockSandbox;
  };
  entrypoints: {
    main: string;
    worker?: string;
    ui?: string;
    a2a_agent_card?: string;
    mcp_server?: string;
  };
  scripts: {
    test: string;
    install?: string;
    activate?: string;
    deactivate?: string;
    upgrade?: string;
    rollback?: string;
    uninstall?: string;
  };
  capabilities: BlockCapability[];
  contracts: {
    consumes: BlockContractRef[];
    produces: BlockContractRef[];
  };
  events?: {
    publishes?: string[];
    subscribes?: string[];
  };
  panels?: BlockPanel[];
  memory_scope?: {
    project_shared?: string[];
    block_private?: string[];
    global_shared?: string[];
  };
  artifact_types?: string[];
  optimizer_policy: {
    editable: boolean;
    editable_fields?: string[];
    never_editable?: string[];
    requires_human_approval?: string[];
  };
  security: {
    sandbox: BlockSandbox;
    allow_fs_read: string[];
    allow_fs_write: string[];
    allow_network: boolean;
    allow_child_process: boolean;
    secrets_access: string[];
    max_memory_mb: number;
    max_cpu_pct: number;
  };
  signing?: {
    algorithm: 'ed25519' | string;
    key_id: string;
    signature_file: string;
  };
  certification: {
    state: BlockCertificationState;
    certified_by?: string;
    certified_at?: string;
    sbom?: string;
    notes?: string;
  };
}

export interface BlockManifestIssue {
  path: string;
  code: string;
  message: string;
}

export interface BlockPackageValidationReport {
  status: 'valid' | 'invalid';
  rootDir: string;
  manifestPath: string;
  manifest?: BlockManifest;
  errors: BlockManifestIssue[];
  warnings: BlockManifestIssue[];
  summary: {
    id?: string;
    version?: string;
    capabilityCount: number;
    consumedContractCount: number;
    producedContractCount: number;
    panelCount: number;
    certificationState?: BlockCertificationState;
  };
}

export class BlockManifestError extends Error {
  constructor(message: string, public readonly code: string, public readonly manifestPath?: string) {
    super(message);
    this.name = 'BlockManifestError';
  }
}

const RUNTIME_MODES = new Set<BlockRuntimeMode>(['trusted-core', 'local-worker', 'wasm', 'container', 'remote']);
const SANDBOXES = new Set<BlockSandbox>(['none', 'process-isolated', 'wasm-wasi', 'container-oci']);
const PANEL_SLOTS = new Set<BlockPanelSlot>(['left', 'center', 'right', 'bottom', 'modal', 'sidebar']);
const CERTIFICATION_STATES = new Set<BlockCertificationState>(['dev', 'internal', 'pilot', 'certified', 'revoked']);
const REQUIRED_NEVER_EDITABLE = ['id', 'version', 'capabilities', 'security', 'signing'] as const;
const REQUIRED_HUMAN_APPROVAL = ['runtime', 'entrypoints', 'scripts'] as const;

export async function loadBlockManifest(inputPath: string): Promise<{
  rootDir: string;
  manifestPath: string;
  manifest: BlockManifest;
}> {
  const resolved = path.resolve(inputPath);
  let manifestPath = resolved;
  let rootDir = path.dirname(resolved);

  const inputStat = await stat(resolved).catch((err: unknown) => {
    throw new BlockManifestError(`block path is not readable: ${formatError(err)}`, 'block_path_unreadable', resolved);
  });
  if (inputStat.isDirectory()) {
    rootDir = resolved;
    manifestPath = path.join(resolved, BLOCK_MANIFEST_FILENAME);
  }

  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    throw new BlockManifestError(`cannot read ${BLOCK_MANIFEST_FILENAME}: ${formatError(err)}`, 'manifest_unreadable', manifestPath);
  }

  try {
    return { rootDir, manifestPath, manifest: JSON.parse(raw) as BlockManifest };
  } catch (err) {
    throw new BlockManifestError(`invalid JSON in ${BLOCK_MANIFEST_FILENAME}: ${formatError(err)}`, 'manifest_invalid_json', manifestPath);
  }
}

export async function validateBlockPackage(inputPath: string): Promise<BlockPackageValidationReport> {
  let loaded: Awaited<ReturnType<typeof loadBlockManifest>>;
  try {
    loaded = await loadBlockManifest(inputPath);
  } catch (err) {
    const loadIssue = issue('.', err instanceof BlockManifestError ? err.code : 'manifest_load_failed', formatError(err));
    return {
      status: 'invalid',
      rootDir: path.resolve(inputPath),
      manifestPath: err instanceof BlockManifestError && err.manifestPath ? err.manifestPath : path.join(path.resolve(inputPath), BLOCK_MANIFEST_FILENAME),
      errors: [loadIssue],
      warnings: [],
      summary: emptySummary(),
    };
  }

  const errors: BlockManifestIssue[] = [];
  const warnings: BlockManifestIssue[] = [];
  validateManifestShape(loaded.manifest, errors, warnings);
  await validatePackageFiles(loaded.rootDir, loaded.manifest, errors, warnings);

  return {
    status: errors.length === 0 ? 'valid' : 'invalid',
    rootDir: loaded.rootDir,
    manifestPath: loaded.manifestPath,
    manifest: loaded.manifest,
    errors,
    warnings,
    summary: {
      id: stringValue(loaded.manifest.id),
      version: stringValue(loaded.manifest.version),
      capabilityCount: Array.isArray(loaded.manifest.capabilities) ? loaded.manifest.capabilities.length : 0,
      consumedContractCount: Array.isArray(loaded.manifest.contracts?.consumes) ? loaded.manifest.contracts.consumes.length : 0,
      producedContractCount: Array.isArray(loaded.manifest.contracts?.produces) ? loaded.manifest.contracts.produces.length : 0,
      panelCount: Array.isArray(loaded.manifest.panels) ? loaded.manifest.panels.length : 0,
      certificationState: isCertificationState(loaded.manifest.certification?.state) ? loaded.manifest.certification.state : undefined,
    },
  };
}

function validateManifestShape(manifest: BlockManifest, errors: BlockManifestIssue[], warnings: BlockManifestIssue[]): void {
  const root = manifest as unknown;
  if (!isRecord(root)) {
    errors.push(issue('.', 'manifest_not_object', 'block manifest must be a JSON object'));
    return;
  }

  requireEquals(root, 'pyrfor_manifest_version', BLOCK_MANIFEST_VERSION, errors);
  requirePattern(root, 'id', /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/, 'block id must be reverse-DNS lowercase identifier', errors);
  requireString(root, 'name', errors);
  requirePattern(root, 'version', /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'version must be SemVer (x.y.z)', errors);
  requireString(root, 'description', errors);
  requireString(root, 'author', errors);
  requireString(root, 'license', errors);

  const runtime = requireObject(root, 'runtime', errors);
  if (runtime) {
    requireEnum(runtime, 'mode', RUNTIME_MODES, errors);
    requireString(runtime, 'engine_version_range', errors);
    if ('node_version_range' in runtime) requireString(runtime, 'node_version_range', errors);
    requireEnum(runtime, 'sandbox', SANDBOXES, errors);
  }

  const entrypoints = requireObject(root, 'entrypoints', errors);
  if (entrypoints) requireString(entrypoints, 'main', errors);

  const scripts = requireObject(root, 'scripts', errors);
  if (scripts) {
    requireString(scripts, 'test', errors);
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string' || command.trim() === '') {
        errors.push(issue(`scripts.${name}`, 'script_empty', `scripts.${name} must be a non-empty command string`));
      }
    }
  }

  validateCapabilities(root.capabilities, errors);
  validateContracts(root.contracts, errors);
  validateEvents(root.events, errors);
  validatePanels(root.panels, errors);
  validateStringArrayObject(root.memory_scope, 'memory_scope', ['project_shared', 'block_private', 'global_shared'], errors);
  validateStringArray(root.artifact_types, 'artifact_types', errors, false);
  validateOptimizerPolicy(root.optimizer_policy, errors);
  validateSecurity(root.security, root.runtime, errors, warnings);
  validateSigning(root.signing, root.certification, errors, warnings);
  validateCertification(root.certification, errors);
}

async function validatePackageFiles(
  rootDir: string,
  manifest: BlockManifest,
  errors: BlockManifestIssue[],
  warnings: BlockManifestIssue[],
): Promise<void> {
  const packageJson = await readPackageJson(rootDir, errors);
  const packageScripts = isRecord(packageJson?.scripts) ? packageJson.scripts : undefined;
  if (manifest.runtime?.mode === 'local-worker' && !packageJson) {
    errors.push(issue('package.json', 'package_json_required', 'local-worker blocks require package.json'));
  }
  if (packageScripts) {
    for (const scriptName of Object.keys(manifest.scripts ?? {})) {
      if (typeof packageScripts[scriptName] !== 'string' || !packageScripts[scriptName].trim()) {
        errors.push(issue(`package.json.scripts.${scriptName}`, 'package_script_missing', `package.json must define scripts.${scriptName}`));
      }
    }
  } else if (manifest.scripts) {
    warnings.push(issue('package.json.scripts', 'package_scripts_unchecked', 'package scripts could not be checked because package.json is missing or invalid'));
  }

  if ((manifest.certification?.state === 'pilot' || manifest.certification?.state === 'certified') && manifest.certification.sbom) {
    const sbomPath = path.join(rootDir, manifest.certification.sbom);
    const sbom = await stat(sbomPath).catch(() => undefined);
    if (!sbom?.isFile()) {
      errors.push(issue('certification.sbom', 'sbom_missing', `${manifest.certification.state} blocks require an existing sbom file`));
    }
  }
}

function validateCapabilities(value: unknown, errors: BlockManifestIssue[]): void {
  if (!Array.isArray(value)) {
    errors.push(issue('capabilities', 'capabilities_required', 'capabilities must be an array'));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const pathPrefix = `capabilities.${index}`;
    if (!isRecord(item)) {
      errors.push(issue(pathPrefix, 'capability_not_object', 'capability must be an object'));
      continue;
    }
    const token = requireString(item, 'token', errors, pathPrefix);
    requireString(item, 'reason', errors, pathPrefix);
    if (token) {
      if (token.includes('*')) errors.push(issue(`${pathPrefix}.token`, 'capability_wildcard', 'capability tokens must not contain wildcards'));
      if (!/^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+$/.test(token)) {
        errors.push(issue(`${pathPrefix}.token`, 'capability_token_invalid', 'capability token must use lowercase namespace:action syntax'));
      }
      if (seen.has(token)) errors.push(issue(`${pathPrefix}.token`, 'capability_duplicate', `duplicate capability token: ${token}`));
      seen.add(token);
    }
  }
}

function validateContracts(value: unknown, errors: BlockManifestIssue[]): void {
  const contracts = requireObject({ contracts: value }, 'contracts', errors);
  if (!contracts) return;
  validateContractRefs(contracts.consumes, 'contracts.consumes', errors);
  validateContractRefs(contracts.produces, 'contracts.produces', errors);
}

function validateContractRefs(value: unknown, pathPrefix: string, errors: BlockManifestIssue[]): void {
  if (!Array.isArray(value)) {
    errors.push(issue(pathPrefix, 'contract_refs_required', `${pathPrefix} must be an array`));
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(issue(`${pathPrefix}.${index}`, 'contract_ref_not_object', 'contract reference must be an object'));
      continue;
    }
    requirePattern(item, 'ref', /^[A-Z][A-Za-z0-9]*@[1-9]\d*$/, 'contract ref must match <Name>@<major>', errors, `${pathPrefix}.${index}`);
    if ('from' in item) requireString(item, 'from', errors, `${pathPrefix}.${index}`);
  }
}

function validateEvents(value: unknown, errors: BlockManifestIssue[]): void {
  if (value === undefined) return;
  const events = requireObject({ events: value }, 'events', errors);
  if (!events) return;
  validateEventArray(events.publishes, 'events.publishes', errors);
  validateEventArray(events.subscribes, 'events.subscribes', errors);
}

function validateEventArray(value: unknown, pathPrefix: string, errors: BlockManifestIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(issue(pathPrefix, 'events_array_required', `${pathPrefix} must be an array`));
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+){1,}$/.test(item)) {
      errors.push(issue(`${pathPrefix}.${index}`, 'event_name_invalid', 'event names must use dot-separated lowercase syntax'));
    }
  }
}

function validatePanels(value: unknown, errors: BlockManifestIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(issue('panels', 'panels_array_required', 'panels must be an array'));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const pathPrefix = `panels.${index}`;
    if (!isRecord(item)) {
      errors.push(issue(pathPrefix, 'panel_not_object', 'panel must be an object'));
      continue;
    }
    const id = requireString(item, 'id', errors, pathPrefix);
    requireEnum(item, 'slot', PANEL_SLOTS, errors, pathPrefix);
    requireString(item, 'label', errors, pathPrefix);
    requireString(item, 'entry', errors, pathPrefix);
    validateStringArray(item.requires_capabilities, `${pathPrefix}.requires_capabilities`, errors, false);
    if (id) {
      if (seen.has(id)) errors.push(issue(`${pathPrefix}.id`, 'panel_duplicate', `duplicate panel id: ${id}`));
      seen.add(id);
    }
  }
}

function validateOptimizerPolicy(value: unknown, errors: BlockManifestIssue[]): void {
  const policy = requireObject({ optimizer_policy: value }, 'optimizer_policy', errors);
  if (!policy) return;
  if (typeof policy.editable !== 'boolean') {
    errors.push(issue('optimizer_policy.editable', 'optimizer_editable_required', 'optimizer_policy.editable must be boolean'));
  }
  validateStringArray(policy.editable_fields, 'optimizer_policy.editable_fields', errors, false);
  const neverEditable = validateStringArray(policy.never_editable, 'optimizer_policy.never_editable', errors, true);
  const humanApproval = validateStringArray(policy.requires_human_approval, 'optimizer_policy.requires_human_approval', errors, true);
  for (const field of REQUIRED_NEVER_EDITABLE) {
    if (!neverEditable?.includes(field)) {
      errors.push(issue('optimizer_policy.never_editable', 'optimizer_never_editable_missing', `never_editable must include ${field}`));
    }
  }
  for (const field of REQUIRED_HUMAN_APPROVAL) {
    if (!humanApproval?.includes(field)) {
      errors.push(issue('optimizer_policy.requires_human_approval', 'optimizer_human_approval_missing', `requires_human_approval must include ${field}`));
    }
  }
}

function validateSecurity(value: unknown, runtime: unknown, errors: BlockManifestIssue[], warnings: BlockManifestIssue[]): void {
  const security = requireObject({ security: value }, 'security', errors);
  if (!security) return;
  requireEnum(security, 'sandbox', SANDBOXES, errors, 'security');
  validateStringArray(security.allow_fs_read, 'security.allow_fs_read', errors, true);
  validateStringArray(security.allow_fs_write, 'security.allow_fs_write', errors, true);
  validateStringArray(security.secrets_access, 'security.secrets_access', errors, true);
  requireBoolean(security, 'allow_network', errors, 'security');
  requireBoolean(security, 'allow_child_process', errors, 'security');
  requirePositiveNumber(security, 'max_memory_mb', errors, 'security');
  requirePositiveNumber(security, 'max_cpu_pct', errors, 'security', 100);
  if (isRecord(runtime) && typeof runtime.sandbox === 'string' && typeof security.sandbox === 'string' && runtime.sandbox !== security.sandbox) {
    errors.push(issue('security.sandbox', 'security_sandbox_mismatch', 'security.sandbox must match runtime.sandbox'));
  }
  if (security.allow_network === true) {
    warnings.push(issue('security.allow_network', 'network_requires_review', 'network-enabled blocks require explicit operator review before pilot/certification'));
  }
  if (security.allow_child_process === true) {
    warnings.push(issue('security.allow_child_process', 'child_process_requires_review', 'child_process-enabled blocks require explicit operator review before pilot/certification'));
  }
}

function validateSigning(value: unknown, certification: unknown, errors: BlockManifestIssue[], warnings: BlockManifestIssue[]): void {
  const state = isRecord(certification) && typeof certification.state === 'string' ? certification.state : undefined;
  if (value === undefined) {
    if (state === 'pilot' || state === 'certified') {
      errors.push(issue('signing', 'signing_required', `${state} blocks require signing metadata`));
    } else {
      warnings.push(issue('signing', 'signing_missing', 'dev/internal blocks may omit signing metadata, but publishing requires it'));
    }
    return;
  }
  const signing = requireObject({ signing: value }, 'signing', errors);
  if (!signing) return;
  if (signing.algorithm !== 'ed25519') {
    errors.push(issue('signing.algorithm', 'signing_algorithm_invalid', 'signing.algorithm must be ed25519 for Manifest v1'));
  }
  requireString(signing, 'key_id', errors, 'signing');
  requireString(signing, 'signature_file', errors, 'signing');
}

function validateCertification(value: unknown, errors: BlockManifestIssue[]): void {
  const certification = requireObject({ certification: value }, 'certification', errors);
  if (!certification) return;
  requireEnum(certification, 'state', CERTIFICATION_STATES, errors, 'certification');
  const state = certification.state;
  if ((state === 'pilot' || state === 'certified') && typeof certification.sbom !== 'string') {
    errors.push(issue('certification.sbom', 'certification_sbom_required', `${state} blocks require certification.sbom`));
  }
}

function validateStringArrayObject(value: unknown, pathPrefix: string, keys: string[], errors: BlockManifestIssue[]): void {
  if (value === undefined) return;
  const object = requireObject({ [pathPrefix]: value }, pathPrefix, errors);
  if (!object) return;
  for (const key of keys) validateStringArray(object[key], `${pathPrefix}.${key}`, errors, false);
}

function validateStringArray(value: unknown, pathPrefix: string, errors: BlockManifestIssue[], required: boolean): string[] | undefined {
  if (value === undefined) {
    if (required) errors.push(issue(pathPrefix, 'string_array_required', `${pathPrefix} must be an array`));
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(issue(pathPrefix, 'string_array_invalid', `${pathPrefix} must be an array of strings`));
    return undefined;
  }
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '') {
      errors.push(issue(`${pathPrefix}.${index}`, 'string_array_item_invalid', `${pathPrefix}.${index} must be a non-empty string`));
      continue;
    }
    result.push(item);
  }
  return result;
}

async function readPackageJson(rootDir: string, errors: BlockManifestIssue[]): Promise<Record<string, unknown> | undefined> {
  const packageJsonPath = path.join(rootDir, 'package.json');
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      errors.push(issue('package.json', 'package_json_not_object', 'package.json must contain a JSON object'));
      return undefined;
    }
    return parsed;
  } catch (err) {
    errors.push(issue('package.json', 'package_json_invalid', `package.json is invalid JSON: ${formatError(err)}`));
    return undefined;
  }
}

function requireObject(object: Record<string, unknown>, key: string, errors: BlockManifestIssue[]): Record<string, unknown> | undefined {
  const value = object[key];
  if (!isRecord(value)) {
    errors.push(issue(key, 'object_required', `${key} must be an object`));
    return undefined;
  }
  return value;
}

function requireString(object: Record<string, unknown>, key: string, errors: BlockManifestIssue[], prefix?: string): string | undefined {
  const value = object[key];
  const pathPrefix = prefix ? `${prefix}.${key}` : key;
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(issue(pathPrefix, 'string_required', `${pathPrefix} must be a non-empty string`));
    return undefined;
  }
  return value;
}

function requirePattern(
  object: Record<string, unknown>,
  key: string,
  re: RegExp,
  message: string,
  errors: BlockManifestIssue[],
  prefix?: string,
): string | undefined {
  const value = requireString(object, key, errors, prefix);
  if (value && !re.test(value)) errors.push(issue(prefix ? `${prefix}.${key}` : key, 'pattern_mismatch', message));
  return value;
}

function requireEnum<T extends string>(
  object: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<T>,
  errors: BlockManifestIssue[],
  prefix?: string,
): T | undefined {
  const value = object[key];
  const pathPrefix = prefix ? `${prefix}.${key}` : key;
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    errors.push(issue(pathPrefix, 'enum_invalid', `${pathPrefix} must be one of: ${[...allowed].join(', ')}`));
    return undefined;
  }
  return value as T;
}

function requireEquals(object: Record<string, unknown>, key: string, expected: string, errors: BlockManifestIssue[]): void {
  if (object[key] !== expected) errors.push(issue(key, 'value_invalid', `${key} must be "${expected}"`));
}

function requireBoolean(object: Record<string, unknown>, key: string, errors: BlockManifestIssue[], prefix?: string): void {
  const pathPrefix = prefix ? `${prefix}.${key}` : key;
  if (typeof object[key] !== 'boolean') errors.push(issue(pathPrefix, 'boolean_required', `${pathPrefix} must be boolean`));
}

function requirePositiveNumber(
  object: Record<string, unknown>,
  key: string,
  errors: BlockManifestIssue[],
  prefix?: string,
  max?: number,
): void {
  const value = object[key];
  const pathPrefix = prefix ? `${prefix}.${key}` : key;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (max !== undefined && value > max)) {
    errors.push(issue(pathPrefix, 'number_invalid', `${pathPrefix} must be a positive number${max !== undefined ? ` <= ${max}` : ''}`));
  }
}

function issue(pathValue: string, code: string, message: string): BlockManifestIssue {
  return { path: pathValue, code, message };
}

function emptySummary(): BlockPackageValidationReport['summary'] {
  return {
    capabilityCount: 0,
    consumedContractCount: 0,
    producedContractCount: 0,
    panelCount: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isCertificationState(value: unknown): value is BlockCertificationState {
  return typeof value === 'string' && CERTIFICATION_STATES.has(value as BlockCertificationState);
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
