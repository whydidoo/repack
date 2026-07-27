import {
  RscCompatibilityError,
  RscRequestError,
  RscValidationError,
  isRscCompatibilityError,
  isRscRequestError,
  isRscValidationError,
} from '../../index.js';

describe('RSC errors', () => {
  it('creates and narrows an explicitly public request error', () => {
    const error = new RscRequestError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      status: 401,
    });

    expect({
      code: error.code,
      isRequestError: isRscRequestError(error),
      message: error.message,
      name: error.name,
      status: error.status,
    }).toEqual({
      code: 'UNAUTHORIZED',
      isRequestError: true,
      message: 'Authentication required',
      name: 'RscRequestError',
      status: 401,
    });
  });

  it('rejects invalid or framework-reserved public request errors', () => {
    expect(
      () =>
        new RscRequestError({
          code: 'INVALID_STATUS',
          message: 'Invalid status',
          status: 200,
        })
    ).toThrow('status must be an integer between 400 and 599');

    expect(
      () =>
        new RscRequestError({
          code: 'VALIDATION_FAILED',
          message: 'Reserved code',
          status: 400,
        })
    ).toThrow('code "VALIDATION_FAILED" is reserved by Re.Pack');
  });

  it('creates and narrows a validation error without retaining input', () => {
    const error = new RscValidationError({
      issues: [
        {
          message: 'Expected a string',
          path: ['teamId'],
        },
      ],
    });

    expect({
      code: error.code,
      input: 'input' in error,
      isRequestError: isRscRequestError(error),
      isValidationError: isRscValidationError(error),
      issues: error.issues,
      message: error.message,
      name: error.name,
      status: error.status,
    }).toEqual({
      code: 'VALIDATION_FAILED',
      input: false,
      isRequestError: false,
      isValidationError: true,
      issues: [
        {
          message: 'Expected a string',
          path: ['teamId'],
        },
      ],
      message: 'Request validation failed',
      name: 'RscValidationError',
      status: 400,
    });
  });

  it('creates and narrows a compatibility error with safe mismatch fields', () => {
    const error = new RscCompatibilityError({
      expected: '7',
      reason: 'runtimeVersion',
      received: '8',
    });

    expect({
      code: error.code,
      expected: error.expected,
      isCompatibilityError: isRscCompatibilityError(error),
      isRequestError: isRscRequestError(error),
      isValidationError: isRscValidationError(error),
      message: error.message,
      name: error.name,
      reason: error.reason,
      received: error.received,
      status: error.status,
    }).toEqual({
      code: 'RSC_INCOMPATIBLE',
      expected: '7',
      isCompatibilityError: true,
      isRequestError: false,
      isValidationError: false,
      message: 'RSC runtimeVersion is incompatible',
      name: 'RscCompatibilityError',
      reason: 'runtimeVersion',
      received: '8',
      status: 409,
    });
  });
});
