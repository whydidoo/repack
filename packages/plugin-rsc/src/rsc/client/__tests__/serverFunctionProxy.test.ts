import type { RscTransportRequest } from '../../runtime/index.js';
import { createRscClientRuntime } from '../clientRuntime.js';

describe('generated Server Function caller', () => {
  it('decodes Flight when the host has no global TextDecoder', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'TextDecoder'
    );
    const identity = {
      exportName: 'checkMe',
      sourcePath: 'functions/checkMe.server.ts',
    };

    try {
      Reflect.deleteProperty(globalThis, 'TextDecoder');
      const runtime = createRscClientRuntime({
        config: {
          createTransport: () => ({
            fetch: async () => new Response('flight result'),
          }),
        },
        context: {
          development: false,
          platform: 'ios',
          runtimeVersion: '7',
          unit: 'account',
        },
        decode: async () =>
          new TextDecoder().decode(Uint8Array.from([111, 107])),
        encode: async () => 'encoded action',
        roots: [],
        serverFunctions: [{ id: 'rsc_action_42', identity }],
      });
      const checkMe = runtime.createServerFnProxy<undefined, string>(identity);

      await expect(checkMe({ data: undefined })).resolves.toBe('ok');
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'TextDecoder', descriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'TextDecoder');
      }
    }
  });

  it('runs ordered client middleware and merges function-specific headers', async () => {
    const events: string[] = [];
    const fetch = jest.fn(async (request: RscTransportRequest) => {
      const headers = new Headers(request.init.headers);
      expect(headers.get('authorization')).toBe('Bearer token');
      expect(headers.get('x-check-token')).toBe('check-42');
      events.push('fetch');
      return new Response('flight result');
    });
    const identity = {
      exportName: 'checkMe',
      sourcePath: 'functions/checkMe.server.ts',
    };
    const runtime = createRscClientRuntime({
      config: { createTransport: () => ({ fetch }) },
      context: {
        development: false,
        platform: 'android',
        runtimeVersion: '7',
        unit: 'account',
      },
      decode: async () => true,
      encode: async () => 'encoded action',
      roots: [],
      serverFunctions: [{ id: 'rsc_action_42', identity }],
    });
    const auth = runtime.createMiddleware().client(async ({ next }) => {
      events.push('auth before');
      const result = await next({
        headers: { authorization: 'Bearer token' },
      });
      events.push('auth after');
      return result;
    });
    const checkToken = runtime.createMiddleware().client(async ({ next }) => {
      events.push('check before');
      const result = await next({
        headers: { 'x-check-token': 'check-42' },
      });
      events.push('check after');
      return result;
    });
    const checkMe = runtime.createServerFnProxy<undefined, boolean>(identity, [
      auth,
      checkToken,
    ]);

    await expect(checkMe({ data: undefined })).resolves.toBe(true);

    expect(events).toEqual([
      'auth before',
      'check before',
      'fetch',
      'check after',
      'auth after',
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful action without Flight data as a protocol error', async () => {
    const identity = {
      exportName: 'checkMe',
      sourcePath: 'functions/checkMe.server.ts',
    };
    const runtime = createRscClientRuntime({
      config: {
        createTransport: () => ({
          fetch: async () => new Response(null, { status: 204 }),
        }),
      },
      context: {
        development: false,
        platform: 'ios',
        runtimeVersion: '7',
        unit: 'account',
      },
      decode: async () => true,
      encode: async () => 'encoded action',
      roots: [],
      serverFunctions: [{ id: 'rsc_action_42', identity }],
    });
    const checkMe = runtime.createServerFnProxy<undefined, boolean>(identity);

    await expect(checkMe({ data: undefined })).rejects.toMatchObject({
      code: 'RSC_PROTOCOL_ERROR',
      status: 502,
    });
  });

  it('forwards cancellation without retrying the action', async () => {
    const aborted = new Error('Cancelled');
    aborted.name = 'AbortError';
    const fetch = jest.fn(async (_request: RscTransportRequest) => {
      throw aborted;
    });
    const identity = {
      exportName: 'checkMe',
      sourcePath: 'functions/checkMe.server.ts',
    };
    const runtime = createRscClientRuntime({
      config: { createTransport: () => ({ fetch }) },
      context: {
        development: false,
        platform: 'android',
        runtimeVersion: '7',
        unit: 'account',
      },
      decode: async () => true,
      encode: async () => 'encoded action',
      roots: [],
      serverFunctions: [{ id: 'rsc_action_42', identity }],
    });
    const checkMe = runtime.createServerFnProxy<undefined, boolean>(identity);
    const controller = new AbortController();

    const result = checkMe({ data: undefined, signal: controller.signal });
    controller.abort();

    await expect(result).rejects.toBe(aborted);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0].init.signal).toBe(controller.signal);
  });

  it('surfaces pre-stream action failures as typed Re.Pack errors', async () => {
    const fetch = jest.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'UNAUTHORIZED',
            detail: 'Authentication required',
            status: 401,
            title: 'UNAUTHORIZED',
            type: 'about:blank',
          }),
          {
            headers: { 'content-type': 'application/problem+json' },
            status: 401,
          }
        )
      )
    );
    const identity = {
      exportName: 'checkMe',
      sourcePath: 'functions/checkMe.server.ts',
    };
    const runtime = createRscClientRuntime({
      config: { createTransport: () => ({ fetch }) },
      context: {
        development: false,
        platform: 'ios',
        runtimeVersion: '7',
        unit: 'account',
      },
      decode: async () => true,
      encode: async () => 'encoded action',
      roots: [],
      serverFunctions: [{ id: 'rsc_action_42', identity }],
    });
    const checkMe = runtime.createServerFnProxy<undefined, boolean>(identity);

    await expect(checkMe({ data: undefined })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      status: 401,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an old unit action after replacement without affecting another unit', async () => {
    let resolveOldFetch!: (response: Response) => void;
    let markOldFetchStarted!: () => void;
    const oldFetchStarted = new Promise<void>((resolve) => {
      markOldFetchStarted = resolve;
    });
    const oldDispose = jest.fn(async () => undefined);
    const otherDispose = jest.fn(async () => undefined);
    const identity = {
      exportName: 'checkMe',
      sourcePath: 'functions/checkMe.server.ts',
    };
    const oldRuntime = createRscClientRuntime({
      config: {
        createTransport: () => ({
          dispose: oldDispose,
          fetch: () => {
            markOldFetchStarted();
            return new Promise<Response>((resolve) => {
              resolveOldFetch = resolve;
            });
          },
        }),
      },
      context: {
        development: true,
        platform: 'ios',
        runtimeVersion: '7',
        unit: 'old-widget',
      },
      decode: async () => 'old result',
      encode: async () => 'encoded action',
      roots: [],
      serverFunctions: [{ id: 'rsc_action_old', identity }],
    });
    const otherRuntime = createRscClientRuntime({
      config: {
        createTransport: () => ({
          dispose: otherDispose,
          fetch: async () => new Response('other result'),
        }),
      },
      context: {
        development: true,
        platform: 'ios',
        runtimeVersion: '7',
        unit: 'other-widget',
      },
      decode: async () => 'other result',
      encode: async () => 'encoded action',
      roots: [],
      serverFunctions: [{ id: 'rsc_action_other', identity }],
    });
    const oldAction = oldRuntime.createServerFnProxy(identity);
    const otherAction = otherRuntime.createServerFnProxy(identity);

    const staleResult = oldAction({ data: undefined });
    await oldFetchStarted;
    const firstDispose = oldRuntime.dispose();
    const secondDispose = oldRuntime.dispose();
    resolveOldFetch(new Response('stale result'));

    await expect(staleResult).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.all([firstDispose, secondDispose]);
    await expect(otherAction({ data: undefined })).resolves.toBe(
      'other result'
    );
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(otherDispose).not.toHaveBeenCalled();
  });
});
