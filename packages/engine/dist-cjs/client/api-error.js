"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = exports.APIError = void 0;
exports.isAuthApiError = isAuthApiError;
exports.apiRequest = apiRequest;
class APIError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "APIError";
    }
}
exports.APIError = APIError;
function isAuthApiError(error) {
    return error instanceof APIError && (error.status === 401 || error.status === 403);
}
async function parseResponse(response) {
    if (response.status === 204) {
        throw new APIError("Unexpected empty response", response.status, "EMPTY_RESPONSE");
    }
    return response.json();
}
async function apiRequest(url, options) {
    const response = await fetch(url, {
        ...options,
        cache: "no-store",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers,
        },
    });
    if (!response.ok) {
        let message = "Unknown error";
        let code;
        try {
            const errorData = (await response.json());
            if (typeof errorData.error === "string") {
                message = errorData.error || message;
            }
            else if (errorData.error && typeof errorData.error === "object") {
                message = errorData.error.message || errorData.message || message;
                code = errorData.error.code || errorData.code;
            }
            else {
                message = errorData.message || message;
                code = errorData.code;
            }
        }
        catch {
            // Expected: response may not be valid JSON, use defaults
        }
        throw new APIError(message, response.status, code);
    }
    return parseResponse(response);
}
exports.api = {
    get: (url) => apiRequest(url),
    post: (url, data) => apiRequest(url, {
        method: "POST",
        body: JSON.stringify(data),
    }),
    put: (url, data) => apiRequest(url, {
        method: "PUT",
        body: JSON.stringify(data),
    }),
    delete: (url) => apiRequest(url, {
        method: "DELETE",
    }),
};
