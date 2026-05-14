import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import { type VerifyCheck, type VerifyCheckResult, type VerifyResult } from '../verify-engine';
import { type CriticReport, type EnsembleConfig, type VerifierRunner, type VerifierVerdict } from './critic';
export interface AcceptanceCheck {
    id: string;
    label: string;
    verifyCheck: VerifyCheck;
    weight: number;
    criticalOnFailure?: boolean;
}
export interface AcceptanceTestSuite {
    suiteId: string;
    conceptId: string;
    runId: string;
    subjectId: string;
    checks: AcceptanceCheck[];
    workdir: string;
    thresholdScore?: number;
    timeoutMs?: number;
}
export interface AcceptanceReport {
    suiteId: string;
    conceptId: string;
    runId: string;
    subjectId: string;
    verdict: VerifierVerdict;
    status: 'passed' | 'needs_rework' | 'blocked';
    score: number;
    thresholdScore: number;
    checkResults: VerifyCheckResult[];
    criticReport?: CriticReport;
    artifactId: string;
    artifactRef: ArtifactRef;
    reworkCycle: number;
    testedAt: string;
}
export interface AcceptanceTesterDeps {
    artifactStore: ArtifactStore;
    ledger: EventLedger;
    criticConfig?: EnsembleConfig;
    criticRunners?: ReadonlyMap<string, VerifierRunner>;
    maxReworkCycles?: number;
    clock?: () => number;
}
export declare class TestSuiteValidationError extends Error {
    constructor(message: string);
}
export declare class AcceptanceTester {
    private readonly deps;
    private readonly maxReworkCycles;
    private readonly clock;
    constructor(deps: AcceptanceTesterDeps);
    run(suite: AcceptanceTestSuite, reworkCycle?: number): Promise<AcceptanceReport>;
    runWithRework(suite: AcceptanceTestSuite, regenerateSuite?: (report: AcceptanceReport) => Promise<AcceptanceTestSuite>): Promise<AcceptanceReport>;
    private runOptionalCritic;
}
export declare function validateTestSuite(suite: AcceptanceTestSuite): void;
export declare function checksToVerifyChecks(checks: AcceptanceCheck[], defaultTimeoutMs?: number): VerifyCheck[];
export declare function deriveVerdict(result: VerifyResult, checks: AcceptanceCheck[]): VerifierVerdict;
//# sourceMappingURL=tester.d.ts.map