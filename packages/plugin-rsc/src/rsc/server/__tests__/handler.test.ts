import { createRscHandler } from '../handler.js';
import {
  createMiddleware,
  createServerFn,
  defineRscRoot,
  defineRscServer,
} from '../index.js';

describe('createRscHandler', () => {
  it.each([
    ['server definition', { server: {} }],
    ['root definition', { roots: new Map([['root-1', () => null]]) }],
    [
      'Server Function definition',
      { serverFunctions: new Map([['action-1', () => null]]) },
    ],
  ])('rejects an invalid %s while composing the handler', (_label, update) => {
    const createContext = jest.fn(() => ({}));
    const rootRenderer = jest.fn(() => 'root');
    const actionHandler = jest.fn(() => 'action');
    const options = {
      development: false,
      platformManifests: [createPlatformManifest('7')],
      roots: new Map([['root-1', defineRscRoot(rootRenderer)]]),
      runtimeVersion: '7',
      server: defineRscServer({ createContext }),
      serverFunctions: new Map([
        ['action-1', createServerFn().handler(actionHandler)],
      ]),
      unit: 'widget',
      ...update,
    };

    expect(() =>
      createRscHandler(options, {
        createDigest: () => 'unused-digest',
        decodeReply: jest.fn(),
        render: jest.fn(),
      })
    ).toThrow();
    expect(createContext).not.toHaveBeenCalled();
    expect(rootRenderer).not.toHaveBeenCalled();
    expect(actionHandler).not.toHaveBeenCalled();
  });

  it.each(['global', 'Server Function'] as const)(
    'rejects malformed %s middleware while composing the handler',
    (scope) => {
      const createContext = jest.fn(() => ({}));
      const actionHandler = jest.fn(() => 'action');
      const malformedMiddleware = {};
      const action = createServerFn()
        .middleware(scope === 'Server Function' ? [malformedMiddleware] : [])
        .handler(actionHandler);

      expect(() =>
        createRscHandler(
          {
            development: false,
            platformManifests: [createPlatformManifest('7')],
            roots: new Map(),
            runtimeVersion: '7',
            server: defineRscServer({
              createContext,
              middleware: scope === 'global' ? [malformedMiddleware] : [],
            }),
            serverFunctions: new Map([['action-1', action]]),
            unit: 'widget',
          },
          {
            createDigest: () => 'unused-digest',
            decodeReply: jest.fn(),
            render: jest.fn(),
          }
        )
      ).toThrow('Expected middleware created by createMiddleware().');
      expect(createContext).not.toHaveBeenCalled();
      expect(actionHandler).not.toHaveBeenCalled();
    }
  );

  it('rejects an incompatible runtime before application code', async () => {
    const createContext = jest.fn(() => ({}));
    const onError = jest.fn();
    const decodeReply = jest.fn();
    const render = jest.fn();
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('8')],
        roots: new Map(),
        runtimeVersion: '8',
        server: defineRscServer({ createContext, onError }),
        serverFunctions: new Map(),
        unit: 'widget',
      },
      { createDigest: () => 'unused-digest', decodeReply, render }
    );
    const request = new Request('https://example.test/rsc', {
      body: 'unused-flight-body',
      headers: {
        accept: 'text/x-component',
        'x-repack-rsc-kind': 'render',
        'x-repack-rsc-platform': 'ios',
        'x-repack-rsc-protocol-version': '1',
        'x-repack-rsc-runtime-version': '7',
        'x-repack-rsc-unit': 'widget',
      },
      method: 'POST',
    });

    const response = await handler(request);

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json'
    );
    await expect(response.json()).resolves.toEqual({
      code: 'RSC_INCOMPATIBLE',
      detail: 'RSC runtimeVersion is incompatible',
      expected: '8',
      reason: 'runtimeVersion',
      received: '7',
      status: 409,
      title: 'RSC compatibility error',
      type: 'about:blank',
    });
    expect(createContext).not.toHaveBeenCalled();
    expect(decodeReply).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('rejects an unsupported platform before decoding or application code', async () => {
    const createContext = jest.fn(() => ({}));
    const decodeReply = jest.fn();
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('7')],
        roots: new Map(),
        runtimeVersion: '7',
        server: defineRscServer({ createContext }),
        serverFunctions: new Map(),
        unit: 'widget',
      },
      {
        createDigest: () => 'unused-digest',
        decodeReply,
        render: jest.fn(),
      }
    );
    const request = createRequest('render', 'unused-flight-body');
    request.headers.set('x-repack-rsc-platform', 'android');

    const response = await handler(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      expected: 'ios',
      reason: 'platform',
      received: 'android',
    });
    expect(decodeReply).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
  });

  it('renders a compatible root as a no-store Flight stream', async () => {
    const createContext = jest.fn(() => ({ viewer: { id: 'viewer-1' } }));
    const Root = defineRscRoot(({ context }) => `hello ${context.viewer.id}`);
    const decodeReply = jest.fn(async () => ({ id: 'root-1', props: {} }));
    const render = jest.fn(
      (model: unknown) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(`flight:${String(model)}`)
            );
            controller.close();
          },
        })
    );
    const clientManifest = {
      'client-1': { async: false, chunks: [], id: 42, name: 'default' },
    };
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [
          createPlatformManifest('7', [
            {
              id: 'client-1',
              identity: {
                exportName: 'default',
                sourcePath: 'Button.tsx',
              },
              target: {
                async: false,
                chunks: [],
                exportName: 'default',
                moduleId: 42,
              },
            },
          ]),
        ],
        roots: new Map([['root-1', Root]]),
        runtimeVersion: '7',
        server: defineRscServer({ createContext }),
        serverFunctions: new Map(),
        unit: 'widget',
      },
      { createDigest: () => 'error-digest', decodeReply, render }
    );
    const request = createRequest('render', 'encoded-root');

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/x-component');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('flight:hello viewer-1');
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(decodeReply).toHaveBeenCalledWith('encoded-root', {});
    expect(render).toHaveBeenCalledWith(
      'hello viewer-1',
      clientManifest,
      expect.objectContaining({
        onError: expect.any(Function),
        signal: request.signal,
      })
    );
  });

  it('calls an action through global and function middleware', async () => {
    const events: string[] = [];
    const globalMiddleware = createMiddleware().server(async ({ next }) => {
      events.push('global before');
      const result = await next();
      events.push('global after');
      return result;
    });
    const functionMiddleware = createMiddleware().server(async ({ next }) => {
      events.push('function before');
      const result = await next({ context: { permission: 'read' } });
      events.push('function after');
      return result;
    });
    const action = createServerFn()
      .middleware([functionMiddleware])
      .handler(({ context, data }) => {
        events.push('handler');
        return `${context.viewer.id}:${context.permission}:${String(data)}`;
      });
    const decodeReply = jest.fn(async () => {
      events.push('decode');
      return {
        data: 'team-1',
        id: 'action-1',
      };
    });
    const render = jest.fn((model: unknown) => {
      events.push('render');
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(String(model)));
          controller.close();
        },
      });
    });
    const createContext = jest.fn(() => {
      events.push('context');
      return { viewer: { id: 'viewer-1' } };
    });
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('7')],
        roots: new Map(),
        runtimeVersion: '7',
        server: defineRscServer({
          createContext,
          middleware: [globalMiddleware],
        }),
        serverFunctions: new Map([['action-1', action]]),
        unit: 'widget',
      },
      { createDigest: () => 'error-digest', decodeReply, render }
    );

    const request = createRequest('action', 'encoded-action');
    const response = await handler(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('viewer-1:read:team-1');
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(createContext).toHaveBeenCalledWith({
      request,
      signal: request.signal,
    });
    expect(events).toEqual([
      'decode',
      'context',
      'global before',
      'function before',
      'handler',
      'function after',
      'global after',
      'render',
    ]);
  });

  it('uses the immutable global middleware configuration', async () => {
    const events: string[] = [];
    const middleware = [createMiddleware()];
    const server = defineRscServer({
      createContext: () => ({}),
      middleware,
    });
    middleware.push(
      createMiddleware().server(async ({ next }) => {
        events.push('mutated middleware');
        return next();
      })
    );
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('7')],
        roots: new Map([['root-1', defineRscRoot(() => 'root model')]]),
        runtimeVersion: '7',
        server,
        serverFunctions: new Map(),
        unit: 'widget',
      },
      {
        createDigest: () => 'error-digest',
        decodeReply: async () => ({ id: 'root-1', props: {} }),
        render: () => new ReadableStream(),
      }
    );

    const response = await handler(createRequest('render', 'encoded-root'));

    expect(response.status).toBe(200);
    expect(events).toEqual([]);
  });

  it('captures Server Function middleware while composing its dispatch entry', async () => {
    const events: string[] = [];
    const middleware = [createMiddleware()];
    const action = createServerFn()
      .middleware(middleware)
      .handler(() => 'action result');
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('7')],
        roots: new Map(),
        runtimeVersion: '7',
        server: defineRscServer({ createContext: () => ({}) }),
        serverFunctions: new Map([['action-1', action]]),
        unit: 'widget',
      },
      {
        createDigest: () => 'error-digest',
        decodeReply: async () => ({ data: undefined, id: 'action-1' }),
        render: (model) =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(String(model)));
              controller.close();
            },
          }),
      }
    );
    middleware.push(
      createMiddleware().server(async ({ next }) => {
        events.push('mutated middleware');
        return next();
      })
    );

    const response = await handler(createRequest('action', 'encoded-action'));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('action result');
    expect(events).toEqual([]);
  });

  it('uses the executable catalog captured while composing the handler', async () => {
    const roots = new Map<string, unknown>([
      ['root-1', defineRscRoot(() => 'captured root')],
    ]);
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('7')],
        roots,
        runtimeVersion: '7',
        server: defineRscServer({ createContext: () => ({}) }),
        serverFunctions: new Map(),
        unit: 'widget',
      },
      {
        createDigest: () => 'unused-digest',
        decodeReply: async () => ({ id: 'root-1', props: {} }),
        render: (model) =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(String(model)));
              controller.close();
            },
          }),
      }
    );
    roots.clear();
    roots.set('root-1', () => 'mutated root');
    const request = createRequest('render', 'encoded-root');

    const response = await handler(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('captured root');
  });

  it('keeps redaction authoritative when diagnostics fail before the Flight stream starts', async () => {
    const failure = new Error('database password leaked');
    failure.stack = 'SECRET_SERVER_STACK';
    const onError = jest.fn(() => {
      throw new Error('logger secret');
    });
    const Root = defineRscRoot(() => {
      throw failure;
    });
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('7')],
        roots: new Map([['root-1', Root]]),
        runtimeVersion: '7',
        server: defineRscServer({ createContext: () => ({}), onError }),
        serverFunctions: new Map(),
        unit: 'widget',
      },
      {
        createDigest: () => 'error-42',
        decodeReply: async () => ({ id: 'root-1', props: {} }),
        render: jest.fn(),
      }
    );
    const request = createRequest('render', 'encoded-root');

    const response = await handler(request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      detail: 'An internal RSC server error occurred',
      digest: 'error-42',
      status: 500,
      title: 'Internal Server Error',
      type: 'about:blank',
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, {
      digest: 'error-42',
      request,
    });
  });

  it('keeps post-start failures inside the Flight stream', async () => {
    const failure = new Error('nested component failed');
    const onError = jest.fn();
    const Root = defineRscRoot(() => 'root model');
    const render = jest.fn(
      (
        _model: unknown,
        _manifest: Readonly<Record<string, unknown>>,
        options: { readonly onError: (error: unknown) => string }
      ) => {
        const digest = options.onError(failure);
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(`flight-error:${digest}`)
            );
            controller.close();
          },
        });
      }
    );
    const handler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest('7')],
        roots: new Map([['root-1', Root]]),
        runtimeVersion: '7',
        server: defineRscServer({ createContext: () => ({}), onError }),
        serverFunctions: new Map(),
        unit: 'widget',
      },
      {
        createDigest: () => 'flight-digest',
        decodeReply: async () => ({ id: 'root-1', props: {} }),
        render,
      }
    );
    const request = createRequest('render', 'encoded-root');

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/x-component');
    await expect(response.text()).resolves.toBe('flight-error:flight-digest');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, {
      digest: 'flight-digest',
      request,
    });
  });
});

function createRequest(kind: 'action' | 'render', body: string): Request {
  return new Request('https://example.test/rsc', {
    body,
    headers: {
      accept: 'text/x-component',
      'x-repack-rsc-kind': kind,
      'x-repack-rsc-platform': 'ios',
      'x-repack-rsc-protocol-version': '1',
      'x-repack-rsc-runtime-version': '7',
      'x-repack-rsc-unit': 'widget',
    },
    method: 'POST',
  });
}

function createPlatformManifest(
  runtimeVersion: string,
  clientReferences: import(
    '../../artifacts/types.js'
  ).RscPlatformManifest['clientReferences'] = []
): import('../../artifacts/types.js').RscPlatformManifest {
  return {
    clientReferences,
    platform: 'ios',
    protocolVersion: 1,
    runtimeVersion,
    schemaVersion: 1,
    unit: 'widget',
  };
}
