import { isRscCompatibilityError, isRscRequestError } from '../errors/index.js';

export type RscRootRenderResult<FlightTree> =
  | {
      readonly status: 'failure';
      readonly error: unknown;
      readonly fatal: boolean;
    }
  | { readonly status: 'success'; readonly value: FlightTree };

export function successfulRscRootRender<FlightTree>(
  value: FlightTree
): RscRootRenderResult<FlightTree> {
  return { status: 'success', value };
}

export function failedRscRootRequest(
  error: unknown
): RscRootRenderResult<never> {
  return {
    error,
    fatal: true,
    status: 'failure',
  };
}

export function failedRscRootTransport(
  error: unknown
): RscRootRenderResult<never> {
  return {
    error,
    fatal: false,
    status: 'failure',
  };
}

export function failedRscRootFlightDecode(
  error: unknown
): RscRootRenderResult<never> {
  return {
    error,
    fatal: isFatalFlightError(error) || !hasFlightErrorDigest(error),
    status: 'failure',
  };
}

function isFatalFlightError(error: unknown): boolean {
  return (
    isRscCompatibilityError(error) ||
    (isRscRequestError(error) && error.code === 'RSC_PROTOCOL_ERROR')
  );
}

function hasFlightErrorDigest(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof error.digest === 'string'
  );
}
