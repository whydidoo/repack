import { RscValidationError } from '../../index.js';
import { createMiddleware, createServerFn } from '../index.js';
import type { RscServerDefinition, RscStandardSchemaV1 } from '../index.js';
import { prepareServerFn } from '../serverFunction.js';

declare module '../index.js' {
  interface Register {
    server: RscServerDefinition<{
      readonly viewer: { readonly id: string };
    }>;
  }
}

describe('createServerFn', () => {
  it('rejects invalid input before running the handler', async () => {
    let handlerCalled = false;
    const checkMe = createServerFn()
      .inputValidator({
        '~standard': {
          validate: () => ({
            issues: [{ message: 'Expected a string', path: ['userId'] }],
          }),
          vendor: 'test',
          version: 1,
        },
      })
      .handler(() => {
        handlerCalled = true;
        return null;
      });

    await expect(
      prepareServerFn(checkMe).execute({
        context: {},
        data: { userId: 42 },
        signal: new AbortController().signal,
      })
    ).rejects.toEqual(
      new RscValidationError({
        issues: [{ message: 'Expected a string', path: ['userId'] }],
      })
    );
    expect(handlerCalled).toBe(false);
  });

  it('types caller input, validated handler data, context, and result', () => {
    const schema: RscStandardSchemaV1<{ userId: number }, { userId: string }> =
      {
        '~standard': {
          validate: (value) => ({ value: { userId: String(value) } }),
          vendor: 'test',
          version: 1,
        },
      };
    const checkMe = createServerFn()
      .inputValidator(schema)
      .handler(({ context, data, signal }) => {
        const userId: string = data.userId;
        const viewerId: string = context.viewer.id;
        const requestSignal: AbortSignal = signal;
        return userId.length + viewerId.length + Number(requestSignal.aborted);
      });
    const invocation: Parameters<typeof checkMe>[0] = {
      data: { userId: 42 },
    };
    const result: Awaited<ReturnType<typeof checkMe>> = 4;

    expect({ invocation, result }).toEqual({
      invocation: { data: { userId: 42 } },
      result: 4,
    });
  });

  it('passes validated schema output and the request signal to the handler', async () => {
    const signal = new AbortController().signal;
    const checkMe = createServerFn()
      .inputValidator({
        '~standard': {
          validate: (value) => ({ value: String(value) }),
          vendor: 'test',
          version: 1,
        },
      })
      .handler(({ data, signal: handlerSignal }) => ({
        data,
        sameSignal: handlerSignal === signal,
      }));

    await expect(
      prepareServerFn(checkMe).execute({
        context: { viewer: { id: 'viewer-42' } },
        data: 42,
        signal,
      })
    ).resolves.toEqual({ data: '42', sameSignal: true });
  });

  it('keeps unvalidated handler data unknown', () => {
    createServerFn().handler(({ data }) => {
      const untrustedData: unknown = data;
      return untrustedData;
    });
  });

  it('adds middleware context to the Server Function handler type', () => {
    const permissions = createMiddleware().server(({ next }) =>
      next({ context: { permissions: ['read'] } })
    );

    createServerFn()
      .middleware([permissions])
      .handler(({ context }) => {
        const viewerId: string = context.viewer.id;
        const permission: string = context.permissions[0] ?? 'none';
        return { permission, viewerId };
      });
  });
});
