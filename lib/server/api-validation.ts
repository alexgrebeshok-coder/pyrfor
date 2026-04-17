import { NextResponse } from "next/server";
import type { ZodSchema, ZodError } from "zod";

/**
 * Validate a request body against a Zod schema.
 * Returns the parsed value on success, or a NextResponse with 400 status on failure.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: formatZodErrors(result.error),
      },
      { status: 400 }
    );
  }

  return result.data;
}

/**
 * Validate query/search params against a Zod schema.
 */
export function validateParams<T>(
  params: URLSearchParams,
  schema: ZodSchema<T>
): T | NextResponse {
  const raw = Object.fromEntries(params.entries());
  const result = schema.safeParse(raw);

  if (!result.success) {
    return NextResponse.json(
      {
        error: "Invalid query parameters",
        details: formatZodErrors(result.error),
      },
      { status: 400 }
    );
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

function formatZodErrors(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!details[path]) details[path] = [];
    details[path].push(issue.message);
  }
  return details;
}
