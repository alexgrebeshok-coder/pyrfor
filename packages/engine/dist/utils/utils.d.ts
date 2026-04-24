import { type ClassValue } from "clsx";
import { Priority, ProjectDirection, ProjectStatus, RiskStatus, Severity, TaskStatus } from '../types/types';
export declare function cn(...inputs: ClassValue[]): string;
export declare const projectStatusMeta: Record<ProjectStatus, {
    label: string;
    className: string;
    accent: string;
}>;
export declare const taskStatusMeta: Record<TaskStatus, {
    label: string;
    className: string;
}>;
export declare const priorityMeta: Record<Priority, {
    label: string;
    className: string;
}>;
export declare const directionMeta: Record<ProjectDirection, string>;
export declare const severityMeta: Record<Severity, {
    label: string;
    className: string;
}>;
export declare const riskStatusMeta: Record<RiskStatus, {
    label: string;
    className: string;
}>;
export declare function formatCurrency(value: number, currency?: string, locale?: string): string;
export declare function formatDate(value: string, pattern?: string): string;
export declare function initials(value?: string | null): string;
export declare function leadingLabel(value?: string | null, fallback?: string): string;
export declare function clamp(value: number, min?: number, max?: number): number;
export declare function getHealthTone(value: number): string;
export declare function getRiskSeverity(probability: number, impact: number): Severity;
export declare function safePercent(numerator: number, denominator: number): number;
export declare function slugify(value: string): string;
/**
 * Detect if running in Tauri desktop environment
 */
export declare function isTauriDesktop(): boolean;
/**
 * Detect if running inside a Capacitor native shell.
 */
export declare function isCapacitorNativeApp(): boolean;
/**
 * Detect if running inside any native shell, including Tauri desktop and Capacitor iOS.
 */
export declare function isNativeShell(): boolean;
/**
 * Detect if running as standalone PWA or desktop app
 */
export declare function isStandaloneApp(): boolean;
