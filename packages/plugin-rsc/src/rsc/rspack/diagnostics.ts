export type RscSourceLocatedError = Error & {
  readonly filename: string;
  readonly location: { readonly column: number; readonly line: number };
};

export function isRscSourceLocatedError(
  error: unknown
): error is RscSourceLocatedError {
  return (
    error instanceof Error &&
    'filename' in error &&
    typeof error.filename === 'string' &&
    'location' in error &&
    typeof error.location === 'object' &&
    error.location !== null &&
    'column' in error.location &&
    typeof error.location.column === 'number' &&
    'line' in error.location &&
    typeof error.location.line === 'number'
  );
}
