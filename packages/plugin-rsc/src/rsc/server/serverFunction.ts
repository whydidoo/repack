import {
  type PreparedRscServerMiddleware,
  type RscMiddleware,
  type RscMiddlewareContext,
  prepareRscServerMiddleware,
} from './middleware.js';
import type { RegisteredRscContext } from './registration.js';
import type {
  InferRscSchemaInput,
  InferRscSchemaOutput,
  RscStandardSchemaV1,
} from './schema.js';
import { validateRscSchema } from './schema.js';

export interface ServerFnInvocation<Data> {
  readonly data: Data;
  readonly signal?: AbortSignal;
}

export interface ServerFnHandlerInput<Data, Context = unknown> {
  readonly context: Context;
  readonly data: Data;
  readonly signal: AbortSignal;
}

export type ServerFn<Input, Result> = (
  invocation: ServerFnInvocation<Input>
) => Promise<Result>;

interface InternalServerFnDefinition {
  readonly handler: (input: ServerFnHandlerInput<unknown>) => unknown;
  readonly inputSchema?: RscStandardSchemaV1;
  readonly middleware: readonly RscMiddleware[];
}

const SERVER_FN_DEFINITION = Symbol('repack.rsc.server-function.definition');

type InternalServerFn = ServerFn<unknown, unknown> & {
  readonly [SERVER_FN_DEFINITION]: InternalServerFnDefinition;
};

export interface PreparedServerFn {
  readonly execute: (input: ServerFnHandlerInput<unknown>) => Promise<unknown>;
  readonly middleware: readonly PreparedRscServerMiddleware[];
}

export interface ServerFnBuilder<
  Input = unknown,
  Data = unknown,
  Context = RegisteredRscContext,
> {
  inputValidator<Schema extends RscStandardSchemaV1>(
    schema: Schema
  ): ServerFnBuilder<
    InferRscSchemaInput<Schema>,
    InferRscSchemaOutput<Schema>,
    Context
  >;
  middleware<const Items extends readonly RscMiddleware[]>(
    items: Items
  ): ServerFnBuilder<Input, Data, Context & RscMiddlewareContext<Items>>;
  handler<Result>(
    handler: (
      input: ServerFnHandlerInput<Data, Context>
    ) => Promise<Result> | Result
  ): ServerFn<Input, Awaited<Result>>;
}

class ServerFnBuilderImpl<Input, Data, Context>
  implements ServerFnBuilder<Input, Data, Context>
{
  constructor(
    private readonly definition: {
      readonly inputSchema?: RscStandardSchemaV1;
      readonly middleware: readonly RscMiddleware[];
    }
  ) {}

  inputValidator<Schema extends RscStandardSchemaV1>(
    schema: Schema
  ): ServerFnBuilder<
    InferRscSchemaInput<Schema>,
    InferRscSchemaOutput<Schema>,
    Context
  > {
    return new ServerFnBuilderImpl({ ...this.definition, inputSchema: schema });
  }

  middleware<const Items extends readonly RscMiddleware[]>(
    items: Items
  ): ServerFnBuilder<Input, Data, Context & RscMiddlewareContext<Items>> {
    return new ServerFnBuilderImpl<
      Input,
      Data,
      Context & RscMiddlewareContext<Items>
    >({ ...this.definition, middleware: items });
  }

  handler<Result>(
    handler: (
      input: ServerFnHandlerInput<Data, Context>
    ) => Promise<Result> | Result
  ): ServerFn<Input, Awaited<Result>> {
    const serverFn = () => {
      throw new Error(
        'A Server Function cannot be called directly in the server graph.'
      );
    };
    Object.defineProperty(serverFn, SERVER_FN_DEFINITION, {
      value: {
        ...this.definition,
        handler: handler as (input: ServerFnHandlerInput<unknown>) => unknown,
      },
    });
    return serverFn as ServerFn<Input, Awaited<Result>>;
  }
}

export function createServerFn(): ServerFnBuilder {
  return new ServerFnBuilderImpl({ middleware: [] });
}

export function prepareServerFn(serverFn: unknown): PreparedServerFn {
  if (typeof serverFn !== 'function' || !(SERVER_FN_DEFINITION in serverFn)) {
    throw new TypeError('Expected a function created by createServerFn().');
  }

  const definition = (serverFn as InternalServerFn)[SERVER_FN_DEFINITION];
  const handler = definition.handler;
  const inputSchema = definition.inputSchema;
  return Object.freeze({
    execute: async (input: ServerFnHandlerInput<unknown>) => {
      const data = inputSchema
        ? await validateRscSchema(inputSchema, input.data)
        : input.data;

      return handler({ ...input, data });
    },
    middleware: prepareRscServerMiddleware(definition.middleware),
  });
}
