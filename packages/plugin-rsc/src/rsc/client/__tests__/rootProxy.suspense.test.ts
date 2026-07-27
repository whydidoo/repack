import { createRequire } from 'node:module';
import { type ReactElement, StrictMode, Suspense, createElement } from 'react';
import type { RscAddressableContract } from '../../artifacts/types.js';
import { createRscClientContractCatalog } from '../contractCatalog.js';
import { useRscRefresh } from '../refresh.js';
import type { RscRootClient } from '../rootClient.js';
import { createRscRootProxyFactory } from '../rootProxy.js';
import type { RscRootRenderResult } from '../rootRenderResult.js';

interface ReactTestRenderer {
  toJSON(): null | string | { readonly [key: string]: unknown };
  unmount(): void;
  update(element: ReactElement): void;
}

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

describe('RSC root proxy Suspense lifecycle', () => {
  it('reuses the initial request when React discards pre-mount hook state', async () => {
    const initial = deferred<RscRootRenderResult<string>>();
    const duplicate = deferred<RscRootRenderResult<string>>();
    const client: RscRootClient<string> = {
      dispose: async () => undefined,
      render: jest
        .fn<Promise<RscRootRenderResult<string>>, []>()
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(duplicate.promise),
    };
    const createProxy = createRscRootProxyFactory({
      catalog: createCatalog(),
      client,
    });
    const Team = createProxy<{ teamId: string }>(root.identity, {
      pending: 'retain',
      reloadOn: ['teamId'],
    });
    const Screen = () =>
      createElement(Team, {
        teamId: 'callstack',
      });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        createElement(
          StrictMode,
          null,
          createElement(
            Suspense,
            { fallback: 'loading' },
            createElement(Screen)
          )
        )
      );
    });

    expect(renderer?.toJSON()).toBe('loading');
    expect(client.render).toHaveBeenCalledTimes(1);

    await act(async () => {
      initial.resolve(success('initial tree'));
      await initial.promise;
    });

    expect(client.render).toHaveBeenCalledTimes(1);
    expect(renderer?.toJSON()).toBe('initial tree');

    await act(async () => renderer?.unmount());
  });

  it('does not let a captured refresh callback start work after unmount', async () => {
    let capturedRefresh: (() => Promise<void>) | undefined;
    function CaptureRefresh() {
      capturedRefresh = useRscRefresh();
      return 'tree';
    }
    const client: RscRootClient<ReactElement> = {
      dispose: async () => undefined,
      render: jest.fn(async () => success(createElement(CaptureRefresh))),
    };
    const createProxy = createRscRootProxyFactory({
      catalog: createCatalog(),
      client,
    });
    const Team = createProxy<{ teamId: string }>(root.identity, {
      pending: 'retain',
      reloadOn: ['teamId'],
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        createElement(
          Suspense,
          { fallback: 'loading' },
          createElement(Team, {
            teamId: 'callstack',
          })
        )
      );
    });
    expect(capturedRefresh).toEqual(expect.any(Function));

    await act(async () => renderer?.unmount());
    await expect(capturedRefresh?.()).rejects.toThrow(
      'Cannot refresh an unmounted RSC root.'
    );

    expect(client.render).toHaveBeenCalledTimes(1);
  });
});

function createCatalog() {
  return createRscClientContractCatalog({ roots: [root], serverFunctions: [] });
}

function success<Value>(value: Value): RscRootRenderResult<Value> {
  return { status: 'success', value };
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
