import {
  RscCompatibilityError,
  type RscCompatibilityReason,
  RscRequestError,
  RscValidationError,
  type RscValidationIssue,
  isRscCompatibilityError,
  isRscRequestError,
  isRscValidationError,
} from '../errors/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createProtocolError(): RscRequestError {
  return new RscRequestError({
    code: 'RSC_PROTOCOL_ERROR',
    message: 'Received an invalid RSC problem response',
    status: 502,
  });
}

function isValidationIssue(value: unknown): value is RscValidationIssue {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    Array.isArray(value.path) &&
    value.path.every(
      (segment) => typeof segment === 'string' || typeof segment === 'number'
    )
  );
}

function isCompatibilityReason(
  value: unknown
): value is RscCompatibilityReason {
  return (
    value === 'platform' ||
    value === 'protocolVersion' ||
    value === 'runtimeVersion' ||
    value === 'unit'
  );
}

export interface RscProblemDetails {
  readonly code: string;
  readonly detail: string;
  readonly digest?: string;
  readonly expected?: number | string;
  readonly issues?: readonly RscValidationIssue[];
  readonly reason?: RscCompatibilityReason;
  readonly received?: number | string;
  readonly stack?: string;
  readonly status: number;
  readonly title: string;
  readonly type: 'about:blank';
}

export type ToRscProblemDetailsOptions =
  | {
      readonly development: false;
      readonly digest: string;
    }
  | {
      readonly development: true;
    };

export type ParsedRscProblem =
  | RscCompatibilityError
  | RscRequestError
  | RscValidationError;

export function toRscProblemDetails(
  error: unknown,
  options: ToRscProblemDetailsOptions
): RscProblemDetails {
  if (isRscCompatibilityError(error)) {
    return {
      code: error.code,
      detail: `RSC ${error.reason} is incompatible`,
      expected: error.expected,
      reason: error.reason,
      ...(error.received !== undefined && { received: error.received }),
      status: error.status,
      title: 'RSC compatibility error',
      type: 'about:blank',
    };
  }

  if (isRscValidationError(error)) {
    return {
      code: error.code,
      detail: error.message,
      issues: error.issues,
      status: error.status,
      title: 'Validation failed',
      type: 'about:blank',
    };
  }

  if (isRscRequestError(error)) {
    return {
      code: error.code,
      detail: error.message,
      status: error.status,
      title: error.code,
      type: 'about:blank',
    };
  }

  if (options.development) {
    return {
      code: 'INTERNAL_ERROR',
      detail: error instanceof Error ? error.message : 'Unknown RSC error',
      ...(error instanceof Error &&
        error.stack !== undefined && { stack: error.stack }),
      status: 500,
      title: 'Internal Server Error',
      type: 'about:blank',
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    detail: 'An internal RSC server error occurred',
    digest: options.digest,
    status: 500,
    title: 'Internal Server Error',
    type: 'about:blank',
  };
}

export function parseRscProblemDetails(input: unknown): ParsedRscProblem {
  if (
    !isRecord(input) ||
    input.type !== 'about:blank' ||
    typeof input.title !== 'string' ||
    input.title.length === 0 ||
    typeof input.code !== 'string' ||
    input.code.length === 0 ||
    typeof input.detail !== 'string' ||
    typeof input.status !== 'number' ||
    !Number.isInteger(input.status) ||
    input.status < 400 ||
    input.status > 599
  ) {
    return createProtocolError();
  }

  if (input.code === 'VALIDATION_FAILED') {
    if (
      input.status !== 400 ||
      !Array.isArray(input.issues) ||
      !input.issues.every(isValidationIssue)
    ) {
      return createProtocolError();
    }

    return new RscValidationError({
      issues: input.issues,
    });
  }

  if (input.code === 'RSC_INCOMPATIBLE') {
    if (input.status !== 409 || !isCompatibilityReason(input.reason)) {
      return createProtocolError();
    }

    if (input.reason === 'protocolVersion') {
      if (
        typeof input.expected !== 'number' ||
        (input.received !== undefined && typeof input.received !== 'number')
      ) {
        return createProtocolError();
      }

      return new RscCompatibilityError({
        expected: input.expected,
        reason: input.reason,
        ...(input.received !== undefined && { received: input.received }),
      });
    }

    if (
      typeof input.expected !== 'string' ||
      (input.received !== undefined && typeof input.received !== 'string')
    ) {
      return createProtocolError();
    }

    return new RscCompatibilityError({
      expected: input.expected,
      reason: input.reason,
      ...(input.received !== undefined && { received: input.received }),
    });
  }

  if (
    (input.digest !== undefined && typeof input.digest !== 'string') ||
    (input.stack !== undefined && typeof input.stack !== 'string')
  ) {
    return createProtocolError();
  }

  return new RscRequestError({
    code: input.code,
    ...(input.digest !== undefined && { digest: input.digest }),
    message: input.detail,
    ...(input.stack !== undefined && { stack: input.stack }),
    status: input.status,
  });
}

export async function parseRscProblemResponse(
  response: Response
): Promise<ParsedRscProblem> {
  const contentType = response.headers.get('content-type');
  if (
    contentType?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/problem+json'
  ) {
    return createProtocolError();
  }

  let input: unknown;
  try {
    input = await response.json();
  } catch {
    return createProtocolError();
  }

  const error = parseRscProblemDetails(input);
  if (
    (isRscRequestError(error) && error.code === 'RSC_PROTOCOL_ERROR') ||
    error.status !== response.status
  ) {
    return createProtocolError();
  }

  return error;
}
