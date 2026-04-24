var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class APIError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "APIError";
    }
}
export function isAuthApiError(error) {
    return error instanceof APIError && (error.status === 401 || error.status === 403);
}
function parseResponse(response) {
    return __awaiter(this, void 0, void 0, function* () {
        if (response.status === 204) {
            throw new APIError("Unexpected empty response", response.status, "EMPTY_RESPONSE");
        }
        return response.json();
    });
}
export function apiRequest(url, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(url, Object.assign(Object.assign({}, options), { cache: "no-store", headers: Object.assign({ "Content-Type": "application/json" }, options === null || options === void 0 ? void 0 : options.headers) }));
        if (!response.ok) {
            let message = "Unknown error";
            let code;
            try {
                const errorData = (yield response.json());
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
            catch (_a) {
                // Expected: response may not be valid JSON, use defaults
            }
            throw new APIError(message, response.status, code);
        }
        return parseResponse(response);
    });
}
export const api = {
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
