import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import type { RscAddressableContract } from '../../artifacts/types.js';
import { createRscClientContractCatalog } from '../contractCatalog.js';
import type { RscRootClient } from '../rootClient.js';
import { createRscRootProxyFactory } from '../rootProxy.js';
import type { RscRootRenderResult } from '../rootRenderResult.js';

jest.mock('react', () => ({
  createContext: jest.fn(() => ({ Provider: Symbol('RscRefreshProvider') })),
  createElement: jest.fn((type, props, child) => ({ child, props, type })),
  useContext: jest.fn(),
  useEffect: jest.fn(),
  useLayoutEffect: jest.fn(),
  useReducer: jest.fn(),
  useRef: jest.fn(),
}));

const mockUseEffect = jest.mocked(useEffect);
const mockUseLayoutEffect = jest.mocked(useLayoutEffect);
const mockUseReducer = jest.mocked(useReducer);
const mockUseRef = jest.mocked(useRef);

const root: RscAddressableContract = {
  id: 'rsc_root_4d31',
  identity: {
    exportName: 'Team',
    sourcePath: 'roots/Team.rsc.tsx',
  },
};

describe('createRscRootProxyFactory', () => {
  it('recreates a root state when Fast Refresh preserves its React ref', async () => {
    const oldClient: RscRootClient<string> = {
      dispose: async () => undefined,
      render: jest.fn(async () => success('old tree')),
    };
    const newClient: RscRootClient<string> = {
      dispose: async () => undefined,
      render: jest.fn(async () => success('new tree')),
    };
    const oldFactory = createRscRootProxyFactory({
      catalog: createCatalog(),
      client: oldClient,
    });
    const OldTeam = oldFactory(root.identity);
    const instanceRef = { current: null };
    const forceRender = jest.fn();
    let mountInstance: (() => void | (() => void)) | undefined;
    let mountRoot: (() => void) | undefined;
    mockUseRef.mockReturnValue(instanceRef);
    mockUseReducer.mockReturnValue([0, forceRender]);
    mockUseLayoutEffect.mockImplementation((effect) => {
      mountRoot = effect;
    });
    mockUseEffect.mockImplementation((effect) => {
      mountInstance = effect;
    });

    expect(OldTeam({})).toBeNull();
    mountRoot?.();
    mountInstance?.();
    await captureThrown(() => OldTeam({}));
    expect((OldTeam({}) as unknown as { child: string }).child).toBe(
      'old tree'
    );

    oldFactory.dispose();
    const newFactory = createRscRootProxyFactory({
      catalog: createCatalog(),
      client: newClient,
    });
    const NewTeam = newFactory(root.identity);
    expect((NewTeam({}) as unknown as { child: string }).child).toBe(
      'old tree'
    );
    mountRoot?.();
    await captureThrown(() => NewTeam({}));

    expect((NewTeam({}) as unknown as { child: string }).child).toBe(
      'new tree'
    );
    expect(oldClient.render).toHaveBeenCalledTimes(1);
    expect(newClient.render).toHaveBeenCalledTimes(1);
  });

  it('keeps a mounted root from another unit intact', async () => {
    let otherSignal: AbortSignal | undefined;
    const replacedClient: RscRootClient<string> = {
      dispose: async () => undefined,
      render: async () => success('replaced unit tree'),
    };
    const otherClient: RscRootClient<string> = {
      dispose: async () => undefined,
      render: jest.fn(async ({ signal }) => {
        otherSignal = signal;
        return success('other unit tree');
      }),
    };
    const replacedFactory = createRscRootProxyFactory({
      catalog: createCatalog(),
      client: replacedClient,
    });
    const otherFactory = createRscRootProxyFactory({
      catalog: createCatalog(),
      client: otherClient,
    });
    const ReplacedTeam = replacedFactory(root.identity);
    const OtherTeam = otherFactory(root.identity);

    async function mount(
      Component: (props: object) => unknown,
      instanceRef: { current: null }
    ): Promise<void> {
      let mountInstance: (() => void | (() => void)) | undefined;
      let mountRoot: (() => void) | undefined;
      mockUseRef.mockReturnValue(instanceRef);
      mockUseReducer.mockReturnValue([0, jest.fn()]);
      mockUseLayoutEffect.mockImplementation((effect) => {
        mountRoot = effect;
      });
      mockUseEffect.mockImplementation((effect) => {
        mountInstance = effect;
      });
      expect(Component({})).toBeNull();
      mountRoot?.();
      mountInstance?.();
      await captureThrown(() => Component({}));
    }

    await mount(ReplacedTeam, { current: null });
    const otherRef = { current: null };
    await mount(OtherTeam, otherRef);
    replacedFactory.dispose();
    mockUseRef.mockReturnValue(otherRef);

    expect((OtherTeam({}) as unknown as { child: string }).child).toBe(
      'other unit tree'
    );
    expect(otherSignal?.aborted).toBe(false);
    expect(otherClient.render).toHaveBeenCalledTimes(1);
  });
});

function createCatalog() {
  return createRscClientContractCatalog({ roots: [root], serverFunctions: [] });
}

function success<Value>(value: Value): RscRootRenderResult<Value> {
  return { status: 'success', value };
}

function captureThrown(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}
