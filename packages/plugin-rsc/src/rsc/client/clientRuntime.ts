import type { ReactNode } from 'react';
import type { RscAddressableContract } from '../artifacts/types.js';
import { createRscClientContractCatalog } from './contractCatalog.js';
import { createClientMiddleware } from './middleware.js';
import {
  type CreateRscRootClientInput,
  createRscRootClient,
} from './rootClient.js';
import {
  type CreateRscRootProxy,
  createRscRootProxyFactory,
} from './rootProxy.js';
import {
  type CreateServerFnProxy,
  createServerFnProxyFactory,
} from './serverFunctionProxy.js';
import { ensureRscTextDecoder } from './textDecoder.js';

export interface CreateRscClientRuntimeInput extends CreateRscRootClientInput {
  readonly roots: readonly RscAddressableContract[];
  readonly serverFunctions: readonly RscAddressableContract[];
}

export interface RscClientRuntime {
  readonly createMiddleware: typeof createClientMiddleware;
  readonly createRscRootProxy: CreateRscRootProxy;
  readonly createServerFnProxy: CreateServerFnProxy;
  dispose(): Promise<void>;
}

export function createRscClientRuntime(
  input: CreateRscClientRuntimeInput
): RscClientRuntime {
  ensureRscTextDecoder();
  const catalog = createRscClientContractCatalog(input);
  const client = createRscRootClient<ReactNode>(input);
  const rootProxies = createRscRootProxyFactory({
    catalog,
    client,
  });
  return {
    createMiddleware: createClientMiddleware,
    createRscRootProxy: rootProxies,
    createServerFnProxy: createServerFnProxyFactory({
      catalog,
      client,
    }),
    dispose: () => {
      rootProxies.dispose();
      return client.dispose();
    },
  };
}
