import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";

import { badRequest, validationError } from "@/lib/server/api-utils";

export type ValidateBodyOptions = {
  required?: boolean;
  emptyValue?: unknown;
  invalidJsonMessage?: string;
  invalidJsonCode?: string;
  missingBodyMessage?: string;
  missingBodyCode?: string;
};

export const requiredJsonBodyOptions: ValidateBodyOptions = {
  required: true,
  invalidJsonCode: "INVALID_JSON",
  invalidJsonMessage: "Request body must be valid JSON.",
  missingBodyCode: "REQUEST_BODY_REQUIRED",
  missingBodyMessage: "Request body is required.",
};

export async function readJsonBody(
  request: Request,
  options: ValidateBodyOptions = {}
): Promise<unknown | NextResponse> {
  const {
    required = false,
    invalidJsonCode = "INVALID_JSON_BODY",
    invalidJsonMessage = "Invalid JSON body",
    missingBodyCode = "REQUEST_BODY_REQUIRED",
    missingBodyMessage = "Request body is required.",
  } = options;

  const rawBody = await request.text();
  if (!rawBody.trim()) {
    if (required) {
      return badRequest(missingBodyMessage, missingBodyCode);
    }

    if ("emptyValue" in options) {
      return options.emptyValue;
    }

    return undefined;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return badRequest(invalidJsonMessage, invalidJsonCode);
  }
}

/**
 * Validate a request body against a Zod schema.
 * Returns the parsed value on success, or a NextResponse with 400 status on failure.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>,
  options: ValidateBodyOptions = {}
): Promise<T | NextResponse> {
  const raw = await readJsonBody(request, options);
  if (raw instanceof NextResponse) {
    return raw;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

/**
 * Validate query/search params against a Zod schema.
 */
export function validateParams<T>(
  params: URLSearchParams | Record<string, string | string[] | null | undefined>,
  schema: ZodSchema<T>
): T | NextResponse {
  const raw =
    params instanceof URLSearchParams
      ? Object.fromEntries(params.entries())
      : Object.fromEntries(
          Object.entries(params).flatMap(([key, value]) => {
            if (value === undefined || value === null) {
              return [];
            }

            return [[key, Array.isArray(value) ? value.join(",") : value]];
          })
        );
  const result = schema.safeParse(raw);

  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

/**
 * Type guard: checks if the result is a NextResponse (validation error).
 */
export function isValidationError<T>(
  result: T | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
