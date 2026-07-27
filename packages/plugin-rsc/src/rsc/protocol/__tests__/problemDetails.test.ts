import {
  RscCompatibilityError,
  RscRequestError,
  RscValidationError,
  isRscCompatibilityError,
  isRscRequestError,
  isRscValidationError,
} from '../../errors/index.js';
import {
  parseRscProblemDetails,
  parseRscProblemResponse,
  toRscProblemDetails,
} from '../problemDetails.js';

describe('RSC Problem Details', () => {
  it('redacts unknown production errors to a digest', () => {
    const sourceError = Object.assign(new Error('Database password leaked'), {
      input: {
        token: 'secret-token',
      },
    });
    sourceError.stack = 'SECRET_SERVER_STACK';

    expect(
      toRscProblemDetails(sourceError, {
        development: false,
        digest: 'error-42',
      })
    ).toEqual({
      code: 'INTERNAL_ERROR',
      detail: 'An internal RSC server error occurred',
      digest: 'error-42',
      status: 500,
      title: 'Internal Server Error',
      type: 'about:blank',
    });
  });

  it('includes message and stack for unknown development errors', () => {
    const sourceError = new Error('Development failure');
    sourceError.stack = 'DEVELOPMENT_STACK';

    expect(
      toRscProblemDetails(sourceError, {
        development: true,
      })
    ).toEqual({
      code: 'INTERNAL_ERROR',
      detail: 'Development failure',
      stack: 'DEVELOPMENT_STACK',
      status: 500,
      title: 'Internal Server Error',
      type: 'about:blank',
    });
  });

  it('serializes explicitly public request errors without a digest', () => {
    expect(
      toRscProblemDetails(
        new RscRequestError({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        }),
        {
          development: false,
          digest: 'unused-digest',
        }
      )
    ).toEqual({
      code: 'UNAUTHORIZED',
      detail: 'Authentication required',
      status: 401,
      title: 'UNAUTHORIZED',
      type: 'about:blank',
    });
  });

  it('serializes only safe validation issues', () => {
    expect(
      toRscProblemDetails(
        new RscValidationError({
          issues: [
            {
              message: 'Expected a string',
              path: ['teamId'],
            },
          ],
        }),
        {
          development: false,
          digest: 'unused-digest',
        }
      )
    ).toEqual({
      code: 'VALIDATION_FAILED',
      detail: 'Request validation failed',
      issues: [
        {
          message: 'Expected a string',
          path: ['teamId'],
        },
      ],
      status: 400,
      title: 'Validation failed',
      type: 'about:blank',
    });
  });

  it('serializes compatibility mismatch fields', () => {
    const error = new RscCompatibilityError({
      expected: 1,
      reason: 'protocolVersion',
      received: 2,
    });
    error.message = 'SECRET_COMPATIBILITY_CONTEXT';

    expect(
      toRscProblemDetails(error, {
        development: false,
        digest: 'unused-digest',
      })
    ).toEqual({
      code: 'RSC_INCOMPATIBLE',
      detail: 'RSC protocolVersion is incompatible',
      expected: 1,
      reason: 'protocolVersion',
      received: 2,
      status: 409,
      title: 'RSC compatibility error',
      type: 'about:blank',
    });
  });

  it('preserves safe internal diagnostics while parsing', () => {
    const productionError = parseRscProblemDetails({
      code: 'INTERNAL_ERROR',
      detail: 'An internal RSC server error occurred',
      digest: 'error-42',
      status: 500,
      title: 'Internal Server Error',
      type: 'about:blank',
    });
    const developmentError = parseRscProblemDetails({
      code: 'INTERNAL_ERROR',
      detail: 'Development failure',
      stack: 'DEVELOPMENT_STACK',
      status: 500,
      title: 'Internal Server Error',
      type: 'about:blank',
    });

    expect({
      developmentStack: developmentError.stack,
      productionDigest: isRscRequestError(productionError)
        ? productionError.digest
        : undefined,
    }).toEqual({
      developmentStack: 'DEVELOPMENT_STACK',
      productionDigest: 'error-42',
    });
  });

  it('parses a public request problem into a typed error', () => {
    const error = parseRscProblemDetails({
      code: 'UNAUTHORIZED',
      detail: 'Authentication required',
      status: 401,
      title: 'UNAUTHORIZED',
      type: 'about:blank',
    });

    expect({
      code: error.code,
      isRequestError: isRscRequestError(error),
      message: error.message,
      status: error.status,
    }).toEqual({
      code: 'UNAUTHORIZED',
      isRequestError: true,
      message: 'Authentication required',
      status: 401,
    });
  });

  it('parses an HTTP Problem Details response with matching metadata', async () => {
    const error = await parseRscProblemResponse(
      new Response(
        JSON.stringify({
          code: 'UNAUTHORIZED',
          detail: 'Authentication required',
          status: 401,
          title: 'UNAUTHORIZED',
          type: 'about:blank',
        }),
        {
          headers: {
            'content-type': 'application/problem+json; charset=utf-8',
          },
          status: 401,
        }
      )
    );

    expect({
      code: error.code,
      message: error.message,
      status: error.status,
    }).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      status: 401,
    });
  });

  it('normalizes invalid HTTP Problem Details framing', async () => {
    const problems = await Promise.all([
      parseRscProblemResponse(
        new Response('{}', {
          headers: {
            'content-type': 'text/plain',
          },
          status: 500,
        })
      ),
      parseRscProblemResponse(
        new Response(
          JSON.stringify({
            code: 'UNAUTHORIZED',
            detail: 'Authentication required',
            status: 401,
            title: 'UNAUTHORIZED',
            type: 'about:blank',
          }),
          {
            headers: {
              'content-type': 'application/problem+json',
            },
            status: 500,
          }
        )
      ),
      parseRscProblemResponse(
        new Response('{', {
          headers: {
            'content-type': 'application/problem+json',
          },
          status: 500,
        })
      ),
    ]);

    expect(
      problems.map((error) => ({
        code: error.code,
        message: error.message,
        status: error.status,
      }))
    ).toEqual(
      problems.map(() => ({
        code: 'RSC_PROTOCOL_ERROR',
        message: 'Received an invalid RSC problem response',
        status: 502,
      }))
    );
  });

  it('parses validation issues into a typed validation error', () => {
    const error = parseRscProblemDetails({
      code: 'VALIDATION_FAILED',
      detail: 'Request validation failed',
      issues: [
        {
          message: 'Expected a string',
          path: ['teamId', 0],
        },
      ],
      status: 400,
      title: 'Validation failed',
      type: 'about:blank',
    });

    expect({
      code: error.code,
      isValidationError: isRscValidationError(error),
      issues: isRscValidationError(error) ? error.issues : undefined,
      status: error.status,
    }).toEqual({
      code: 'VALIDATION_FAILED',
      isValidationError: true,
      issues: [
        {
          message: 'Expected a string',
          path: ['teamId', 0],
        },
      ],
      status: 400,
    });
  });

  it('parses compatibility fields into a typed compatibility error', () => {
    const error = parseRscProblemDetails({
      code: 'RSC_INCOMPATIBLE',
      detail: 'RSC runtimeVersion is incompatible',
      expected: '2026.07',
      reason: 'runtimeVersion',
      received: '2026.06',
      status: 409,
      title: 'RSC compatibility error',
      type: 'about:blank',
    });

    expect({
      expected: isRscCompatibilityError(error) ? error.expected : undefined,
      isCompatibilityError: isRscCompatibilityError(error),
      reason: isRscCompatibilityError(error) ? error.reason : undefined,
      received: isRscCompatibilityError(error) ? error.received : undefined,
      status: error.status,
    }).toEqual({
      expected: '2026.07',
      isCompatibilityError: true,
      reason: 'runtimeVersion',
      received: '2026.06',
      status: 409,
    });
  });

  it('normalizes malformed problems to one deterministic protocol error', () => {
    const malformedProblems = [
      null,
      {
        code: 42,
        detail: {
          input: 'secret-input',
        },
        stack: 'SECRET_SERVER_STACK',
        status: '500',
      },
      {
        code: 'VALIDATION_FAILED',
        detail: 'Request validation failed',
        issues: [{ input: 'secret-input' }],
        status: 400,
        title: 'Validation failed',
        type: 'about:blank',
      },
      {
        code: 'RSC_INCOMPATIBLE',
        detail: 'RSC deployment is incompatible',
        expected: '2026.07',
        reason: 'deploymentUrl',
        status: 409,
        title: 'RSC compatibility error',
        type: 'about:blank',
      },
      {
        code: 'RSC_INCOMPATIBLE',
        detail: 'RSC protocolVersion is incompatible',
        expected: '1',
        reason: 'protocolVersion',
        status: 409,
        title: 'RSC compatibility error',
        type: 'about:blank',
      },
      {
        code: 'RSC_INCOMPATIBLE',
        detail: 'RSC unit is incompatible',
        expected: 42,
        reason: 'unit',
        status: 409,
        title: 'RSC compatibility error',
        type: 'about:blank',
      },
    ];

    expect(
      malformedProblems.map((problem) => {
        const error = parseRscProblemDetails(problem);
        return {
          code: error.code,
          message: error.message,
          status: error.status,
        };
      })
    ).toEqual(
      malformedProblems.map(() => ({
        code: 'RSC_PROTOCOL_ERROR',
        message: 'Received an invalid RSC problem response',
        status: 502,
      }))
    );
  });
});
