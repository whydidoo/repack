import type { RscLogicalIdentity } from '../artifacts/types.js';
import type { RscClientContractCatalog } from './contractCatalog.js';
import { type RscClientMiddleware, runClientMiddleware } from './middleware.js';
import type { RscActionClient } from './rootClient.js';

export interface CreateServerFnProxyFactoryInput {
  readonly catalog: RscClientContractCatalog;
  readonly client: RscActionClient;
}

export type ServerFnProxy<Input, Result> = (invocation: {
  readonly data: Input;
  readonly signal?: AbortSignal;
}) => Promise<Result>;

export type CreateServerFnProxy = <Input = unknown, Result = unknown>(
  identity: RscLogicalIdentity,
  middleware?: readonly RscClientMiddleware[]
) => ServerFnProxy<Input, Result>;

export function createServerFnProxyFactory(
  input: CreateServerFnProxyFactoryInput
): CreateServerFnProxy {
  return <Input, Result>(
    identity: RscLogicalIdentity,
    middleware: readonly RscClientMiddleware[] = []
  ): ServerFnProxy<Input, Result> => {
    const id = input.catalog.resolve('serverFunction', identity);
    return (invocation) => {
      const signal = invocation.signal ?? new AbortController().signal;
      return runClientMiddleware<Result>(middleware, (headers) =>
        input.client.call<Input, Result>({
          data: invocation.data,
          headers,
          id,
          signal,
        })
      );
    };
  };
}
