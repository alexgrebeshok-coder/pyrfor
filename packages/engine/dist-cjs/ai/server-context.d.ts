import type { Locale } from '../utils/translations';
import type { DashboardState } from '../types/types';
import type { AIContextSnapshot } from "./types";
interface ServerAIContextOptions {
    interfaceLocale?: Locale;
    locale?: Locale;
    pathname?: string;
    projectId?: string;
    subtitle?: string;
    title?: string;
}
export declare function loadServerAIContext(options?: ServerAIContextOptions): Promise<AIContextSnapshot>;
export declare function loadServerDashboardState(): Promise<DashboardState>;
export {};
//# sourceMappingURL=server-context.d.ts.map