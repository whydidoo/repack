import { createRequire } from 'node:module';
import {
  Component,
  type ComponentType,
  type ReactElement,
  type ReactNode,
  Suspense,
  createElement,
} from 'react';
import type { RscAddressableContract } from '../../artifacts/types.js';
import { RscRequestError } from '../../errors/index.js';
import type { RscTransport, RscTransportRequest } from '../../runtime/index.js';
import { createRscHandler } from '../../server/handler.js';
import {
  createMiddleware,
  createServerFn,
  defineRscRoot,
  defineRscServer,
} from '../../server/index.js';
import { createRscClientRuntime } from '../clientRuntime.js';
import { useRscRefresh } from '../refresh.js';

interface ReactTestRenderer {
  toJSON(): null | string | { readonly [key: string]: unknown };
  unmount(): void;
  update(element: ReactElement): void;
}

interface CapturedRequest {
  readonly body: unknown;
  readonly headers: Headers;
  readonly kind: RscTransportRequest['kind'];
  readonly signal: AbortSignal | undefined;
}

type RequestHandler = (
  request: CapturedRequest
) => Promise<Response> | Response;

const { act, create } = createRequire(__filename)('react-test-renderer') as {
  act(callback: () => Promise<void> | void): Promise<void>;
  create(element: ReactElement): ReactTestRenderer;
};

const root: RscAddressableContract = {
  id: 'rsc_root_4d31',
  identity: {
    exportName: 'Team',
    sourcePath: 'roots/Team.rsc.tsx',
  },
};

const action: RscAddressableContract = {
  id: 'rsc_action_42',
  identity: {
    exportName: 'checkMe',
    sourcePath: 'functions/checkMe.server.ts',
  },
};

const originalConsoleError = console.error;
let consoleError: jest.SpiedFunction<typeof console.error>;

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation((message, ...optionalParams) => {
      if (
        [message, ...optionalParams].some(
          (value) =>
            (value instanceof Error &&
              (value.message === 'Invalid Flight row' ||
                value.message === 'Request validation failed')) ||
            (typeof value === 'object' &&
              value !== null &&
              'code' in value &&
              value.code === 'RSC_PROTOCOL_ERROR')
        )
      ) {
        return;
      }
      if (
        message !==
        'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer'
      ) {
        originalConsoleError(message, ...optionalParams);
      }
    });
});

afterAll(() => {
  consoleError.mockRestore();
  delete (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT;
});

describe('composed RSC client runtime', () => {
  it('renders a generated root proxy through the unit transport', async () => {
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('team:callstack'));
    const runtime = createRuntime(transport);
    const Team = runtime.createRscRootProxy<{ teamId: string }>(root.identity, {
      pending: 'retain',
      reloadOn: ['teamId'],
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, { teamId: 'callstack' }));
    });

    expect(renderer?.toJSON()).toBe('team:callstack');
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      body: { id: root.id, props: { teamId: 'callstack' } },
      kind: 'render',
    });
    expect(transport.requests[0]?.headers.get('x-repack-rsc-unit')).toBe(
      'widget'
    );

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('keeps the latest root identity when an aborted transport response arrives late', async () => {
    const older = deferred<Response>();
    const latest = deferred<Response>();
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('team:initial'));
    transport.respond(() => older.promise);
    transport.respond(() => latest.promise);
    const runtime = createRuntime(transport);
    const Team = runtime.createRscRootProxy<{ teamId: string }>(root.identity, {
      pending: 'retain',
      reloadOn: ['teamId'],
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, { teamId: 'initial' }));
    });
    await act(async () => {
      renderer?.update(screen(Team, { teamId: 'older' }));
    });
    expect(renderer?.toJSON()).toBe('team:initial');

    await act(async () => {
      renderer?.update(screen(Team, { teamId: 'latest' }));
    });
    expect(transport.requests[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      latest.resolve(flight('team:latest'));
      await latest.promise;
    });
    expect(renderer?.toJSON()).toBe('team:latest');

    await act(async () => {
      older.resolve(flight('team:older'));
      await older.promise;
    });
    expect(renderer?.toJSON()).toBe('team:latest');
    expect(transport.requests.map(({ body }) => body)).toEqual([
      { id: root.id, props: { teamId: 'initial' } },
      { id: root.id, props: { teamId: 'older' } },
      { id: root.id, props: { teamId: 'latest' } },
    ]);

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('shows the configured fallback while an identity transition is pending', async () => {
    const changed = deferred<Response>();
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('team:callstack'));
    transport.respond(() => changed.promise);
    const runtime = createRuntime(transport);
    const Team = runtime.createRscRootProxy<{ teamId: string }>(root.identity, {
      pending: 'fallback',
      reloadOn: ['teamId'],
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, { teamId: 'callstack' }));
    });
    await act(async () => {
      renderer?.update(screen(Team, { teamId: 'repack' }));
    });
    expect(renderer?.toJSON()).toBe('loading');

    await act(async () => {
      changed.resolve(flight('team:repack'));
      await changed.promise;
    });
    expect(renderer?.toJSON()).toBe('team:repack');

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('cancels a transition when the root returns to its displayed identity', async () => {
    const changed = deferred<Response>();
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('team:callstack'));
    transport.respond(() => changed.promise);
    const runtime = createRuntime(transport);
    const Team = runtime.createRscRootProxy<{ teamId: string }>(root.identity, {
      pending: 'retain',
      reloadOn: ['teamId'],
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, { teamId: 'callstack' }));
    });
    await act(async () => {
      renderer?.update(screen(Team, { teamId: 'repack' }));
    });
    await act(async () => {
      renderer?.update(screen(Team, { teamId: 'callstack' }));
    });

    expect(renderer?.toJSON()).toBe('team:callstack');
    expect(transport.requests[1]?.signal?.aborted).toBe(true);
    expect(transport.requests).toHaveLength(2);

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('keeps the current tree while the latest explicit refresh uses committed props', async () => {
    let refresh: (() => Promise<void>) | undefined;
    function RefreshableTree({ label }: { readonly label: string }) {
      refresh = useRscRefresh();
      return label;
    }
    const older = deferred<Response>();
    const latest = deferred<Response>();
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight({ label: 'team:en', refreshable: true }));
    transport.respond(() => older.promise);
    transport.respond(() => latest.promise);
    const runtime = createRuntime(transport, (value) => {
      if (isRefreshableTree(value)) {
        return createElement(RefreshableTree, { label: value.label });
      }
      return value as ReactNode;
    });
    const Team = runtime.createRscRootProxy<{
      locale: string;
      teamId: string;
    }>(root.identity, { pending: 'retain', reloadOn: ['teamId'] });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, { locale: 'en', teamId: 'callstack' }));
    });
    await act(async () => {
      renderer?.update(screen(Team, { locale: 'tr', teamId: 'callstack' }));
    });
    expect(renderer?.toJSON()).toBe('team:en');
    expect(transport.requests).toHaveLength(1);

    let olderRefresh: Promise<void> | undefined;
    await act(async () => {
      olderRefresh = refresh?.();
      await Promise.resolve();
    });
    const olderResult = expect(olderRefresh).rejects.toMatchObject({
      name: 'AbortError',
    });

    let latestRefresh: Promise<void> | undefined;
    await act(async () => {
      latestRefresh = refresh?.();
      await olderResult;
    });

    expect(renderer?.toJSON()).toBe('team:en');
    expect(transport.requests[1]?.signal?.aborted).toBe(true);
    expect(transport.requests.slice(1).map(({ body }) => body)).toEqual([
      {
        id: root.id,
        props: { locale: 'tr', teamId: 'callstack' },
      },
      {
        id: root.id,
        props: { locale: 'tr', teamId: 'callstack' },
      },
    ]);

    await act(async () => {
      latest.resolve(flight({ label: 'team:tr', refreshable: true }));
      await latestRefresh;
    });

    expect(renderer?.toJSON()).toBe('team:tr');

    await act(async () => {
      older.resolve(flight({ label: 'team:stale', refreshable: true }));
      await older.promise;
    });
    expect(renderer?.toJSON()).toBe('team:tr');

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('keeps the current tree when Flight reports a server error during refresh', async () => {
    let refresh: (() => Promise<void>) | undefined;
    function RefreshableTree() {
      refresh = useRscRefresh();
      return 'team:callstack';
    }
    const failure = Object.assign(new Error('Server render failed'), {
      digest: 'rsc-error-42',
    });
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('initial'));
    transport.respond(() => flight('failed refresh'));
    const runtime = createRuntime(
      transport,
      undefined,
      async (body: ReadableStream<Uint8Array>) => {
        const value = JSON.parse(await new Response(body).text());
        if (value === 'failed refresh') {
          throw failure;
        }
        return createElement(RefreshableTree);
      }
    );
    const Team = runtime.createRscRootProxy(root.identity);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, {}));
    });

    await act(async () => {
      await expect(refresh?.()).rejects.toBe(failure);
    });

    expect(renderer?.toJSON()).toBe('team:callstack');

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('invalidates the current tree when Flight decoding is corrupt during refresh', async () => {
    let refresh: (() => Promise<void>) | undefined;
    function RefreshableTree() {
      refresh = useRscRefresh();
      return 'team:callstack';
    }
    const failure = new Error('Invalid Flight row');
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('initial'));
    transport.respond(() => flight('corrupt refresh'));
    const runtime = createRuntime(
      transport,
      undefined,
      async (body: ReadableStream<Uint8Array>) => {
        const value = JSON.parse(await new Response(body).text());
        if (value === 'corrupt refresh') {
          throw failure;
        }
        return createElement(RefreshableTree);
      }
    );
    const Team = runtime.createRscRootProxy(root.identity);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(errorScreen(Team, {}));
    });

    await act(async () => {
      await expect(refresh?.()).rejects.toBe(failure);
    });

    expect(renderer?.toJSON()).toBe('error:Invalid Flight row');

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('invalidates the current tree for a decoded protocol failure even when it has a digest', async () => {
    let refresh: (() => Promise<void>) | undefined;
    function RefreshableTree() {
      refresh = useRscRefresh();
      return 'team:callstack';
    }
    const failure = Object.assign(
      new RscRequestError({
        code: 'RSC_PROTOCOL_ERROR',
        message: 'Malformed Flight metadata',
        status: 502,
      }),
      { digest: 'protocol-error-42' }
    );
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('initial'));
    transport.respond(() => flight('failed refresh'));
    const runtime = createRuntime(
      transport,
      undefined,
      async (body: ReadableStream<Uint8Array>) => {
        const value = JSON.parse(await new Response(body).text());
        if (value === 'failed refresh') {
          throw failure;
        }
        return createElement(RefreshableTree);
      }
    );
    const Team = runtime.createRscRootProxy(root.identity);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(errorScreen(Team, {}));
    });

    await act(async () => {
      await expect(refresh?.()).rejects.toBe(failure);
    });

    expect(renderer?.toJSON()).toBe('error:Malformed Flight metadata');

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('invalidates the current tree when refresh receives validation Problem Details', async () => {
    let refresh: (() => Promise<void>) | undefined;
    function RefreshableTree() {
      refresh = useRscRefresh();
      return 'team:callstack';
    }
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight('initial'));
    transport.respond(
      () =>
        new Response(
          JSON.stringify({
            code: 'VALIDATION_FAILED',
            detail: 'Request validation failed',
            issues: [{ message: 'Expected a string', path: ['teamId'] }],
            status: 400,
            title: 'Validation failed',
            type: 'about:blank',
          }),
          {
            headers: { 'content-type': 'application/problem+json' },
            status: 400,
          }
        )
    );
    const runtime = createRuntime(transport, () =>
      createElement(RefreshableTree)
    );
    const Team = runtime.createRscRootProxy(root.identity);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(errorScreen(Team, {}));
    });

    await act(async () => {
      await expect(refresh?.()).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      });
    });

    expect(renderer?.toJSON()).toBe('error:Request validation failed');

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('calls a generated Server Function proxy through the same transport contract', async () => {
    const transport = new InMemoryRscTransport();
    transport.respond(() => flight({ allowed: true }));
    const runtime = createRuntime(transport);
    const checkMe = runtime.createServerFnProxy<
      { userId: string },
      { allowed: boolean }
    >(action.identity);

    await expect(checkMe({ data: { userId: '42' } })).resolves.toEqual({
      allowed: true,
    });

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      body: { data: { userId: '42' }, id: action.id },
      kind: 'action',
    });
    expect(transport.requests[0]?.headers.get('x-repack-rsc-kind')).toBe(
      'action'
    );

    await runtime.dispose();
  });

  it('composes render and action proxies through an in-memory transport and Web handler', async () => {
    const serverEvents: string[] = [];
    const actionMiddleware = createMiddleware().server(
      async ({ next, request }) => {
        serverEvents.push('server middleware');
        if (request.headers.get('x-check-token') !== 'valid') {
          throw new Error('Client middleware header was not preserved.');
        }
        return next({ context: { authorized: true } });
      }
    );
    const TeamRoot = defineRscRoot(() => 'team:callstack');
    const CheckAction = createServerFn()
      .middleware([actionMiddleware])
      .handler(({ context, data }) => {
        serverEvents.push('action handler');
        return {
          allowed: context.authorized,
          userId: (data as { readonly userId: string }).userId,
        };
      });
    const webHandler = createRscHandler(
      {
        development: false,
        platformManifests: [createPlatformManifest()],
        roots: new Map([[root.id, TeamRoot]]),
        runtimeVersion: '7',
        server: defineRscServer({ createContext: () => ({}) }),
        serverFunctions: new Map([[action.id, CheckAction]]),
        unit: 'widget',
      },
      {
        createDigest: () => 'composition-error',
        decodeReply: async (body) => JSON.parse(String(body)),
        render: (model) =>
          new Response(JSON.stringify(model))
            .body as ReadableStream<Uint8Array>,
      }
    );
    const capturedRequests: CapturedRequest[] = [];
    const transport: RscTransport = {
      async fetch(request) {
        capturedRequests.push({
          body: decodeRequestBody(request.init.body),
          headers: new Headers(request.init.headers),
          kind: request.kind,
          signal: request.init.signal ?? undefined,
        });
        return webHandler(
          new Request('https://rsc.example.test/application-endpoint', {
            ...request.init,
          })
        );
      },
    };
    const runtime = createRuntime(transport);
    const Team = runtime.createRscRootProxy(root.identity);
    const clientMiddleware = runtime
      .createMiddleware()
      .client(async ({ next }) =>
        next({ headers: { 'x-check-token': 'valid' } })
      );
    const checkMe = runtime.createServerFnProxy<
      { readonly userId: string },
      { readonly allowed: boolean; readonly userId: string }
    >(action.identity, [clientMiddleware]);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, {}));
    });
    await expect(checkMe({ data: { userId: '42' } })).resolves.toEqual({
      allowed: true,
      userId: '42',
    });

    expect(renderer?.toJSON()).toBe('team:callstack');
    expect(capturedRequests.map(({ kind }) => kind)).toEqual([
      'render',
      'action',
    ]);
    expect(capturedRequests[1]?.headers.get('x-check-token')).toBe('valid');
    expect(serverEvents).toEqual(['server middleware', 'action handler']);

    await act(async () => renderer?.unmount());
    await runtime.dispose();
  });

  it('aborts mounted root work and disposes its initialized transport once', async () => {
    const pending = deferred<Response>();
    const transport = new InMemoryRscTransport();
    transport.respond(() => pending.promise);
    const decode = jest.fn(async (body: ReadableStream<Uint8Array>) =>
      JSON.parse(await new Response(body).text())
    );
    const runtime = createRuntime(transport, undefined, decode);
    const Team = runtime.createRscRootProxy(root.identity);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(screen(Team, {}));
    });
    expect(renderer?.toJSON()).toBe('loading');
    expect(transport.requests[0]?.signal?.aborted).toBe(false);

    const firstDispose = runtime.dispose();
    const secondDispose = runtime.dispose();
    await Promise.all([firstDispose, secondDispose]);

    expect(transport.requests[0]?.signal?.aborted).toBe(true);
    expect(transport.disposeCount).toBe(1);

    await act(async () => renderer?.unmount());

    await act(async () => {
      pending.resolve(flight('stale tree'));
      await pending.promise;
    });
    expect(decode).not.toHaveBeenCalled();
  });
});

class InMemoryRscTransport implements RscTransport {
  readonly requests: CapturedRequest[] = [];
  disposeCount = 0;
  readonly #handlers: RequestHandler[] = [];

  respond(handler: RequestHandler): void {
    this.#handlers.push(handler);
  }

  async fetch(request: RscTransportRequest): Promise<Response> {
    const handler = this.#handlers.shift();
    if (!handler) {
      throw new Error(`Unexpected ${request.kind} request.`);
    }
    const captured: CapturedRequest = {
      body: decodeRequestBody(request.init.body),
      headers: new Headers(request.init.headers),
      kind: request.kind,
      signal: request.init.signal ?? undefined,
    };
    this.requests.push(captured);
    return handler(captured);
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

function createRuntime(
  transport: RscTransport,
  mapFlight: (value: unknown) => ReactNode = (value) => value as ReactNode,
  decode = async (body: ReadableStream<Uint8Array>): Promise<unknown> =>
    mapFlight(JSON.parse(await new Response(body).text()))
) {
  return createRscClientRuntime({
    config: { createTransport: () => transport },
    context: {
      development: false,
      platform: 'ios',
      runtimeVersion: '7',
      unit: 'widget',
    },
    decode,
    encode: async (value) => JSON.stringify(value),
    roots: [root],
    serverFunctions: [action],
  });
}

function createPlatformManifest(): import(
  '../../artifacts/types.js'
).RscPlatformManifest {
  return {
    clientReferences: [],
    platform: 'ios',
    protocolVersion: 1,
    runtimeVersion: '7',
    schemaVersion: 1,
    unit: 'widget',
  };
}

function screen<Props extends object>(
  Component: ComponentType<Props>,
  props: Props
): ReactElement {
  return createElement(
    Suspense,
    { fallback: 'loading' },
    createElement(Component, props)
  );
}

function errorScreen<Props extends object>(
  Component: ComponentType<Props>,
  props: Props
): ReactElement {
  return createElement(RootErrorBoundary, null, screen(Component, props));
}

class RootErrorBoundary extends Component<
  { readonly children?: ReactNode },
  { readonly error: unknown }
> {
  state: { readonly error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error instanceof Error) {
      return `error:${this.state.error.message}`;
    }
    return this.props.children;
  }
}

function flight(value: unknown): Response {
  return new Response(JSON.stringify(value));
}

function decodeRequestBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') {
    throw new Error('The in-memory test transport expects a string body.');
  }
  return JSON.parse(body);
}

function isRefreshableTree(
  value: unknown
): value is { readonly label: string; readonly refreshable: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'label' in value &&
    typeof value.label === 'string' &&
    'refreshable' in value &&
    value.refreshable === true
  );
}

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
