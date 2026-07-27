import {
  type ReactNode,
  createElement,
  startTransition,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from 'react';
import type { RscLogicalIdentity } from '../artifacts/types.js';
import type { RscIdentityFieldValue, RscPendingPolicy } from '../rootTypes.js';
import type { RscClientContractCatalog } from './contractCatalog.js';
import { type RscRefresh, RscRefreshContext } from './refresh.js';
import type { RscRootClient } from './rootClient.js';
import { type RscRootState, createRscRootState } from './rootState.js';

export interface CreateRscRootProxyFactoryInput<FlightTree extends ReactNode> {
  readonly catalog: RscClientContractCatalog;
  readonly client: RscRootClient<FlightTree>;
}

export interface RscRootProxyOptions<Props extends object> {
  readonly pending: RscPendingPolicy;
  readonly reloadOn: readonly Extract<keyof Props, string>[];
}

export type RscRootProxy<Props extends object> = (props: Props) => ReactNode;

export type CreateRscRootProxy = <Props extends object = {}>(
  identity: RscLogicalIdentity,
  options?: RscRootProxyOptions<Props>
) => RscRootProxy<Props>;

export interface RscRootProxyFactory extends CreateRscRootProxy {
  dispose(): void;
}

export function createRscRootProxyFactory<FlightTree extends ReactNode>(
  input: CreateRscRootProxyFactoryInput<FlightTree>
): RscRootProxyFactory {
  const instances = new Set<RscRootInstance<object, FlightTree>>();
  const owner = Object.freeze({});
  let disposed = false;

  const createProxy = <Props extends object>(
    identity: RscLogicalIdentity,
    options?: RscRootProxyOptions<Props>
  ): RscRootProxy<Props> => {
    const id = input.catalog.resolve('root', identity);

    const pending = options?.pending ?? 'retain';
    const reloadOn = options?.reloadOn ?? [];
    return function RscRootProxy(componentProps: Props): ReactNode {
      if (disposed) {
        throw new DOMException(
          'The RSC unit runtime owning this root has been disposed.',
          'AbortError'
        );
      }
      const requestIdentity = selectRequestIdentity(componentProps, reloadOn);
      const [, forceRender] = useReducer((version: number) => version + 1, 0);
      const instance = useRef<RscRootInstance<Props, FlightTree> | null>(null);
      useLayoutEffect(() => {
        const previousInstance = instance.current;
        if (previousInstance !== null && previousInstance.owner !== owner) {
          previousInstance.lifecycle += 1;
          previousInstance.mounted = false;
          previousInstance.state.dispose();
          instance.current = null;
        }
        if (instance.current === null) {
          const state = createRscRootState({
            pending,
            render: (nextProps, signal) =>
              input.client.render({ id, props: nextProps, signal }),
          });
          const rootInstance: RscRootInstance<Props, FlightTree> = {
            lifecycle: 0,
            mounted: false,
            owner,
            refresh: async () => {
              if (!rootInstance.mounted) {
                throw new Error('Cannot refresh an unmounted RSC root.');
              }
              try {
                await state.refresh();
              } finally {
                if (rootInstance.mounted) {
                  forceRender();
                }
              }
            },
            state,
          };
          instance.current = rootInstance;
          instances.add(rootInstance as RscRootInstance<object, FlightTree>);
        }
        const commit = instance.current.state.commit(
          componentProps,
          requestIdentity
        );
        if (commit.render === 'urgent') {
          forceRender();
        } else if (commit.render === 'settled') {
          const currentInstance = instance.current;
          void commit.settled.then(() => {
            if (currentInstance.mounted) {
              startTransition(forceRender);
            }
          });
        }
      });
      useEffect(() => {
        const currentInstance = instance.current;
        if (currentInstance === null) {
          return;
        }
        currentInstance.lifecycle += 1;
        currentInstance.mounted = true;
        return () => {
          const lifecycle = ++currentInstance.lifecycle;
          currentInstance.mounted = false;
          queueMicrotask(() => {
            if (
              !currentInstance.mounted &&
              currentInstance.lifecycle === lifecycle
            ) {
              currentInstance.state.dispose();
              instances.delete(
                currentInstance as RscRootInstance<object, FlightTree>
              );
            }
          });
        };
      }, []);
      const currentInstance = instance.current;
      if (currentInstance === null) {
        return null;
      }
      return createElement(
        RscRefreshContext.Provider,
        { value: currentInstance.refresh },
        currentInstance.state.read()
      );
    };
  };

  return Object.assign(createProxy, {
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const instance of instances) {
        instance.lifecycle += 1;
        instance.mounted = false;
        instance.state.dispose();
      }
      instances.clear();
    },
  });
}

interface RscRootInstance<Props, FlightTree> {
  lifecycle: number;
  mounted: boolean;
  readonly owner: object;
  readonly refresh: RscRefresh;
  readonly state: RscRootState<Props, FlightTree>;
}

function selectRequestIdentity<Props extends object>(
  props: Props,
  reloadOn: readonly Extract<keyof Props, string>[]
): readonly RscIdentityFieldValue[] {
  return reloadOn.map((field) => props[field] as RscIdentityFieldValue);
}
