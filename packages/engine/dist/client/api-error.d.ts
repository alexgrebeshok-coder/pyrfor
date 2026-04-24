export declare class APIError extends Error {
    status: number;
    code?: string | undefined;
    constructor(message: string, status: number, code?: string | undefined);
}
export declare function isAuthApiError(error: unknown): error is APIError;
export declare function apiRequest<T>(url: string, options?: RequestInit): Promise<T>;
export declare const api: {
    get: <T>(url: string) => Promise<T>;
    post: <T>(url: string, data: unknown) => Promise<T>;
    put: <T>(url: string, data: unknown) => Promise<T>;
    delete: <T>(url: string) => Promise<T>;
};
//# sourceMappingURL=api-error.d.ts.map