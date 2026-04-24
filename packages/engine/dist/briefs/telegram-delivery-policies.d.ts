import { type TelegramBriefDeliveryRequest } from "./telegram-delivery";
import { type BriefLocale } from "./locale";
export type TelegramDeliveryScope = "portfolio" | "project";
export type TelegramDeliveryCadence = "daily" | "weekdays";
export interface TelegramBriefDeliveryPolicyRecord {
    id: string;
    workspaceId: string;
    scope: TelegramDeliveryScope;
    projectId: string | null;
    projectName: string | null;
    locale: BriefLocale;
    chatId: string | null;
    cadence: TelegramDeliveryCadence;
    timezone: string;
    deliveryHour: number;
    active: boolean;
    createdByUserId: string | null;
    updatedByUserId: string | null;
    lastAttemptAt: string | null;
    lastDeliveredAt: string | null;
    lastMessageId: number | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface CreateTelegramBriefDeliveryPolicyInput {
    workspaceId?: string;
    scope: TelegramDeliveryScope;
    projectId?: string | null;
    locale?: BriefLocale;
    chatId?: string | null;
    cadence?: TelegramDeliveryCadence;
    timezone: string;
    deliveryHour: number;
    active?: boolean;
    createdByUserId?: string | null;
}
export interface UpdateTelegramBriefDeliveryPolicyInput {
    scope?: TelegramDeliveryScope;
    projectId?: string | null;
    locale?: BriefLocale;
    chatId?: string | null;
    cadence?: TelegramDeliveryCadence;
    timezone?: string;
    deliveryHour?: number;
    active?: boolean;
    updatedByUserId?: string | null;
}
export interface TelegramPolicyExecutionCandidate {
    id: string;
    scope: TelegramDeliveryScope;
    projectId: string | null;
    locale: BriefLocale;
    chatId: string | null;
    cadence: TelegramDeliveryCadence;
    timezone: string;
    deliveryHour: number;
    active: boolean;
    lastAttemptAt?: string | Date | null;
    lastDeliveredAt?: string | Date | null;
    lastError?: string | null;
}
export interface TelegramPolicyExecutionResult {
    policyId: string;
    scope: TelegramDeliveryScope;
    projectId: string | null;
    delivered: boolean;
    skipped: boolean;
    reason: "inactive" | "not_due" | "delivered" | "failed";
    messageId?: number;
    error?: string;
}
export interface TelegramPolicyExecutionSummary {
    checkedPolicies: number;
    duePolicies: number;
    deliveredPolicies: number;
    failedPolicies: number;
    skippedPolicies: number;
    timestamp: string;
    results: TelegramPolicyExecutionResult[];
}
export declare function isSupportedTimeZone(value: string): boolean;
export declare function shouldAttemptTelegramPolicy(policy: TelegramPolicyExecutionCandidate, referenceDate?: Date): boolean;
export declare function executeTelegramPolicyRun(policies: TelegramPolicyExecutionCandidate[], deps?: {
    now?: Date;
    deliver?: (request: TelegramBriefDeliveryRequest) => Promise<{
        messageId?: number;
    }>;
    persistResult?: (input: {
        policyId: string;
        attemptedAt: Date;
        deliveredAt?: Date | null;
        messageId?: number | null;
        error?: string | null;
    }) => Promise<void>;
}): Promise<TelegramPolicyExecutionSummary>;
export declare function listTelegramBriefDeliveryPolicies(): Promise<TelegramBriefDeliveryPolicyRecord[]>;
export declare function createTelegramBriefDeliveryPolicy(input: CreateTelegramBriefDeliveryPolicyInput): Promise<TelegramBriefDeliveryPolicyRecord>;
export declare function updateTelegramBriefDeliveryPolicy(id: string, input: UpdateTelegramBriefDeliveryPolicyInput): Promise<TelegramBriefDeliveryPolicyRecord>;
export declare function runDueTelegramBriefDeliveryPolicies(): Promise<TelegramPolicyExecutionSummary>;
//# sourceMappingURL=telegram-delivery-policies.d.ts.map