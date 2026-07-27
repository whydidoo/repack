export type RscCompatibilityReason =
  | 'platform'
  | 'protocolVersion'
  | 'runtimeVersion'
  | 'unit';

export type RscCompatibilityErrorOptions =
  | {
      readonly expected: number;
      readonly reason: 'protocolVersion';
      readonly received?: number;
    }
  | {
      readonly expected: string;
      readonly reason: Exclude<RscCompatibilityReason, 'protocolVersion'>;
      readonly received?: string;
    };

export class RscCompatibilityError extends Error {
  readonly code = 'RSC_INCOMPATIBLE';
  readonly expected: number | string;
  readonly reason: RscCompatibilityReason;
  readonly received?: number | string;
  readonly status = 409;

  constructor(options: RscCompatibilityErrorOptions) {
    super(`RSC ${options.reason} is incompatible`);
    this.name = 'RscCompatibilityError';
    this.expected = options.expected;
    this.reason = options.reason;
    this.received = options.received;
  }
}

export function isRscCompatibilityError(
  value: unknown
): value is RscCompatibilityError {
  return value instanceof RscCompatibilityError;
}

export interface RscRequestErrorOptions {
  readonly code: string;
  readonly digest?: string;
  readonly message: string;
  readonly stack?: string;
  readonly status: number;
}

export class RscRequestError extends Error {
  readonly code: string;
  readonly digest?: string;
  readonly status: number;

  constructor(options: RscRequestErrorOptions) {
    if (
      !Number.isInteger(options.status) ||
      options.status < 400 ||
      options.status > 599
    ) {
      throw new TypeError(
        'RscRequestError status must be an integer between 400 and 599.'
      );
    }

    if (options.code.trim() === '') {
      throw new TypeError('RscRequestError code must be a non-empty string.');
    }

    if (
      options.code === 'RSC_INCOMPATIBLE' ||
      options.code === 'VALIDATION_FAILED'
    ) {
      throw new TypeError(
        `RscRequestError code "${options.code}" is reserved by Re.Pack.`
      );
    }

    super(options.message);
    this.name = 'RscRequestError';
    this.code = options.code;
    this.digest = options.digest;
    this.status = options.status;

    if (options.stack !== undefined) {
      this.stack = options.stack;
    }
  }
}

export function isRscRequestError(value: unknown): value is RscRequestError {
  return value instanceof RscRequestError;
}

export interface RscValidationIssue {
  readonly message: string;
  readonly path: readonly (number | string)[];
}

export interface RscValidationErrorOptions {
  readonly issues: readonly RscValidationIssue[];
}

export class RscValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly issues: readonly RscValidationIssue[];
  readonly status = 400;

  constructor(options: RscValidationErrorOptions) {
    super('Request validation failed');
    this.name = 'RscValidationError';
    this.issues = options.issues.map((issue) => ({
      message: issue.message,
      path: [...issue.path],
    }));
  }
}

export function isRscValidationError(
  value: unknown
): value is RscValidationError {
  return value instanceof RscValidationError;
}
