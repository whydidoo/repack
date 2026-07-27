import type {
  RscRuntimeConfig,
  RscTransport,
  RscTransportContext,
  RscTransportRequest,
} from '../../runtime/index.js';
import { createRscTransportLifecycle } from '../transportLifecycle.js';

const context: RscTransportContext = {
  development: false,
  platform: 'ios',
  runtimeVersion: '7',
  unit: 'widget',
};

function renderRequest(signal?: AbortSignal): RscTransportRequest {
  return {
    init: { method: 'POST', signal },
    kind: 'render',
  };
}

describe('createRscTransportLifecycle', () => {
  it('shares one lazy initialization across ten concurrent first requests', async () => {
    const initialization = deferred<RscTransport>();
    const transport: RscTransport = {
      fetch: jest.fn(async () => new Response('flight')),
    };
    const config: RscRuntimeConfig = {
      createTransport: jest.fn(() => initialization.promise),
    };
    const lifecycle = createRscTransportLifecycle({ config, context });

    expect(config.createTransport).not.toHaveBeenCalled();

    const requests = Array.from({ length: 10 }, () =>
      lifecycle.fetch(renderRequest())
    );
    await Promise.resolve();

    expect(config.createTransport).toHaveBeenCalledTimes(1);
    expect(config.createTransport).toHaveBeenCalledWith(context);
    initialization.resolve(transport);
    await expect(Promise.all(requests)).resolves.toHaveLength(10);
    expect(transport.fetch).toHaveBeenCalledTimes(10);
  });

  it('evicts a rejected initialization so the next request retries', async () => {
    const transport: RscTransport = {
      fetch: jest.fn(async () => new Response('flight')),
    };
    const config: RscRuntimeConfig = {
      createTransport: jest
        .fn<
          ReturnType<RscRuntimeConfig['createTransport']>,
          Parameters<RscRuntimeConfig['createTransport']>
        >()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(transport),
    };
    const lifecycle = createRscTransportLifecycle({ config, context });

    await expect(lifecycle.fetch(renderRequest())).rejects.toThrow('offline');
    await expect(lifecycle.fetch(renderRequest())).resolves.toBeInstanceOf(
      Response
    );
    expect(config.createTransport).toHaveBeenCalledTimes(2);
  });

  it('does not let one request abort shared initialization', async () => {
    const initialization = deferred<RscTransport>();
    const transport: RscTransport = {
      fetch: jest.fn(async (request) => {
        if (request.init.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return new Response('flight');
      }),
    };
    const config: RscRuntimeConfig = {
      createTransport: jest.fn(() => initialization.promise),
    };
    const lifecycle = createRscTransportLifecycle({ config, context });
    const controller = new AbortController();

    const aborted = lifecycle.fetch(renderRequest(controller.signal));
    const active = lifecycle.fetch(renderRequest());
    controller.abort();
    initialization.resolve(transport);

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    await expect(active).resolves.toBeInstanceOf(Response);
    expect(config.createTransport).toHaveBeenCalledTimes(1);
  });

  it('forwards the exact request contract to the transport', async () => {
    const transport: RscTransport = {
      fetch: jest.fn(async () => new Response('result')),
    };
    const lifecycle = createRscTransportLifecycle({
      config: { createTransport: () => transport },
      context,
    });
    const request: RscTransportRequest = {
      init: {
        body: 'flight request',
        headers: { 'x-request': 'root' },
        method: 'POST',
      },
      kind: 'action',
    };

    await lifecycle.fetch(request);

    expect(transport.fetch).toHaveBeenCalledWith(request);
  });

  it('calls optional dispose exactly once after initialization', async () => {
    const transport: RscTransport = {
      dispose: jest.fn(async () => undefined),
      fetch: jest.fn(async () => new Response('flight')),
    };
    const lifecycle = createRscTransportLifecycle({
      config: { createTransport: () => transport },
      context,
    });
    await lifecycle.fetch(renderRequest());

    await Promise.all([
      lifecycle.dispose(),
      lifecycle.dispose(),
      lifecycle.dispose(),
    ]);

    expect(transport.dispose).toHaveBeenCalledTimes(1);
    await expect(lifecycle.fetch(renderRequest())).rejects.toThrow(
      'RSC transport lifecycle for "widget" has been disposed.'
    );
  });

  it('does not initialize a transport only to dispose the lifecycle', async () => {
    const config: RscRuntimeConfig = {
      createTransport: jest.fn(() => ({
        fetch: async () => new Response('flight'),
      })),
    };
    const lifecycle = createRscTransportLifecycle({ config, context });

    await lifecycle.dispose();
    await lifecycle.dispose();

    expect(config.createTransport).not.toHaveBeenCalled();
  });

  it('waits for in-flight initialization before disposing it once', async () => {
    const initialization = deferred<RscTransport>();
    const transport: RscTransport = {
      dispose: jest.fn(async () => undefined),
      fetch: jest.fn(async () => new Response('flight')),
    };
    const lifecycle = createRscTransportLifecycle({
      config: { createTransport: () => initialization.promise },
      context,
    });
    const request = lifecycle.fetch(renderRequest());
    const disposal = lifecycle.dispose();

    initialization.resolve(transport);
    await request;
    await disposal;

    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves streaming responses without buffering them', async () => {
    const response = new Response('progressive flight');
    const lifecycle = createRscTransportLifecycle({
      config: {
        createTransport: () => ({ fetch: async () => response }),
      },
      context,
    });

    await expect(lifecycle.fetch(renderRequest())).resolves.toBe(response);
  });

  it('normalizes a buffered response into a one-part stream', async () => {
    const bytes = new TextEncoder().encode('buffered flight');
    const bufferedResponse = {
      arrayBuffer: jest.fn(async () => bytes.slice().buffer),
      body: null,
      headers: new Headers({ 'content-type': 'text/x-component' }),
      status: 201,
      statusText: 'Created',
    } as unknown as Response;
    const lifecycle = createRscTransportLifecycle({
      config: {
        createTransport: () => ({ fetch: async () => bufferedResponse }),
      },
      context,
    });

    const response = await lifecycle.fetch(renderRequest());

    expect(response).not.toBe(bufferedResponse);
    expect(response.body?.getReader).toEqual(expect.any(Function));
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/x-component');
    await expect(response.text()).resolves.toBe('buffered flight');
  });

  it('normalizes a buffered response without a global ReadableStream', async () => {
    const bytes = new TextEncoder().encode('native buffered flight');
    const bufferedResponse = {
      arrayBuffer: jest.fn(async () => bytes.slice().buffer),
      body: null,
      headers: new Headers({ 'content-type': 'text/x-component' }),
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response;
    const lifecycle = createRscTransportLifecycle({
      config: {
        createTransport: () => ({ fetch: async () => bufferedResponse }),
      },
      context,
    });
    const readableStream = Object.getOwnPropertyDescriptor(
      globalThis,
      'ReadableStream'
    );

    try {
      Reflect.deleteProperty(globalThis, 'ReadableStream');

      const response = await lifecycle.fetch(renderRequest());
      const reader = response.body?.getReader();

      await expect(reader?.read()).resolves.toEqual({
        done: false,
        value: bytes,
      });
      await expect(reader?.read()).resolves.toEqual({
        done: true,
        value: undefined,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/x-component');
    } finally {
      if (readableStream) {
        Object.defineProperty(globalThis, 'ReadableStream', readableStream);
      }
    }
  });
});

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
