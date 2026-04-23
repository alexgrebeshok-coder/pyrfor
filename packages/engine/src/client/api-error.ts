export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "APIError";
  }
}

export function isAuthApiError(error: unknown): error is APIError {
  return error instanceof APIError && (error.status === 401 || error.status === 403);
}

type APIErrorResponse =
  | {
      error?: string;
      code?: string;
      message?: string;
    }
  | {
      error?: {
        code?: string;
        message?: string;
      };
      code?: string;
      message?: string;
    };

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    throw new APIError("Unexpected empty response", response.status, "EMPTY_RESPONSE");
  }

  return response.json() as Promise<T>;
}

export async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
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
    let code: string | undefined;

    try {
      const errorData = (await response.json()) as APIErrorResponse;

      if (typeof errorData.error === "string") {
        message = errorData.error || message;
      } else if (errorData.error && typeof errorData.error === "object") {
        message = errorData.error.message || errorData.message || message;
        code = errorData.error.code || errorData.code;
      } else {
        message = errorData.message || message;
        code = errorData.code;
      }
    } catch {
      // Expected: response may not be valid JSON, use defaults
    }

    throw new APIError(message, response.status, code);
  }

  return parseResponse<T>(response);
}

export const api = {
  get: <T>(url: string) => apiRequest<T>(url),
  post: <T>(url: string, data: unknown) =>
    apiRequest<T>(url, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  put: <T>(url: string, data: unknown) =>
    apiRequest<T>(url, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: <T>(url: string) =>
    apiRequest<T>(url, {
      method: "DELETE",
    }),
};
