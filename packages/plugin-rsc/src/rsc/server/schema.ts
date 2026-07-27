import { RscValidationError } from '../errors/index.js';

export interface RscStandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}

export type RscStandardSchemaResult<Output> =
  | { readonly issues: readonly RscStandardSchemaIssue[] }
  | { readonly issues?: undefined; readonly value: Output };

export interface RscStandardSchemaOptions {
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

export interface RscStandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
    readonly validate: (
      value: unknown,
      options?: RscStandardSchemaOptions | undefined
    ) =>
      | Promise<RscStandardSchemaResult<Output>>
      | RscStandardSchemaResult<Output>;
    readonly vendor: string;
    readonly version: 1;
  };
}

export type InferRscSchemaInput<Schema extends RscStandardSchemaV1> =
  NonNullable<Schema['~standard']['types']> extends {
    readonly input: infer Input;
  }
    ? Input
    : unknown;

export type InferRscSchemaOutput<Schema extends RscStandardSchemaV1> =
  NonNullable<Schema['~standard']['types']> extends {
    readonly output: infer Output;
  }
    ? Output
    : unknown;

function normalizeIssuePath(
  path: RscStandardSchemaIssue['path']
): readonly (number | string)[] {
  return (path ?? []).map((segment) => {
    const key =
      typeof segment === 'object' && segment !== null ? segment.key : segment;
    return typeof key === 'number' || typeof key === 'string'
      ? key
      : String(key);
  });
}

export async function validateRscSchema<Output>(
  schema: RscStandardSchemaV1<unknown, Output>,
  input: unknown
): Promise<Output> {
  const result = await schema['~standard'].validate(input);
  if (result.issues) {
    throw new RscValidationError({
      issues: result.issues.map((issue) => ({
        message: issue.message,
        path: normalizeIssuePath(issue.path),
      })),
    });
  }
  return result.value;
}
