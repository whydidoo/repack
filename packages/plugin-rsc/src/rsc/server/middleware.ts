import type {
  RscClientMiddlewareCallback,
  RscClientMiddlewareInput,
  RscClientMiddlewareNextOptions,
  RscClientMiddlewareResult,
} from '../client/middleware.js';

const MIDDLEWARE_DEFINITION = Symbol('repack.rsc.middleware.definition');
const MIDDLEWARE_RESULT = Symbol('repack.rsc.middleware.result');

export interface RscMiddlewareResult<Context extends object, Value = unknown> {
  readonly context: Readonly<Record<string, unknown>>;
  readonly value: Value;
  readonly '~types'?: { readonly context: Context };
  readonly [MIDDLEWARE_RESULT]: true;
}

export interface RscServerMiddlewareNextOptions<Context extends object> {
  readonly context?: Context;
}

export interface RscServerMiddlewareInput<Context> {
  readonly context: Context;
  readonly next: <AddedContext extends object = Record<never, never>>(
    options?: RscServerMiddlewareNextOptions<AddedContext>
  ) => Promise<RscMiddlewareResult<AddedContext>>;
  readonly request: Request;
  readonly signal: AbortSignal;
}

type RscServerMiddlewareCallback<Context, AddedContext extends object> = (
  input: RscServerMiddlewareInput<Context>
) =>
  | Promise<RscMiddlewareResult<AddedContext>>
  | RscMiddlewareResult<AddedContext>;

interface InternalMiddlewareDefinition {
  readonly client?: RscClientMiddlewareCallback;
  readonly server?: RscServerMiddlewareCallback<unknown, object>;
}

export interface PreparedRscServerMiddleware {
  readonly callback?: RscServerMiddlewareCallback<unknown, object>;
}

export interface RscMiddleware<AddedContext extends object = object> {
  readonly '~types'?: { readonly context: AddedContext };
}

export type RscMiddlewareContext<Middleware extends readonly RscMiddleware[]> =
  Middleware extends readonly []
    ? Record<never, never>
    : UnionToIntersection<
        Middleware[number] extends RscMiddleware<infer Context>
          ? Context
          : never
      >;

type UnionToIntersection<Union> = (
  Union extends unknown
    ? (value: Union) => void
    : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

export interface RscMiddlewareBuilder<
  AddedContext extends object = Record<never, never>,
  InputContext = unknown,
> extends RscMiddleware<AddedContext> {
  client(
    callback: RscClientMiddlewareCallback
  ): RscMiddlewareBuilder<AddedContext, InputContext>;
  server<NewContext extends object = Record<never, never>>(
    callback: RscServerMiddlewareCallback<InputContext, NewContext>
  ): RscMiddlewareBuilder<NewContext, InputContext>;
}

type InternalMiddleware = RscMiddleware & {
  readonly [MIDDLEWARE_DEFINITION]: InternalMiddlewareDefinition;
};

function createMiddlewareBuilder<
  AddedContext extends object = Record<never, never>,
  InputContext = unknown,
>(
  definition: InternalMiddlewareDefinition
): RscMiddlewareBuilder<AddedContext, InputContext> {
  const builder: RscMiddlewareBuilder<AddedContext, InputContext> = {
    client(callback: RscClientMiddlewareCallback) {
      return createMiddlewareBuilder<AddedContext, InputContext>({
        ...definition,
        client: callback,
      });
    },
    server<NewContext extends object = Record<never, never>>(
      callback: RscServerMiddlewareCallback<InputContext, NewContext>
    ) {
      return createMiddlewareBuilder<NewContext, InputContext>({
        ...definition,
        server: callback as RscServerMiddlewareCallback<unknown, object>,
      });
    },
  };
  Object.defineProperty(builder, MIDDLEWARE_DEFINITION, { value: definition });
  return builder;
}

export function createMiddleware<
  InputContext = unknown,
>(): RscMiddlewareBuilder<Record<never, never>, InputContext> {
  return createMiddlewareBuilder<Record<never, never>, InputContext>({});
}

export type {
  RscClientMiddlewareInput,
  RscClientMiddlewareNextOptions,
  RscClientMiddlewareResult,
};

function mergeContext(
  context: Readonly<Record<string, unknown>>,
  addedContext: object | undefined
): Readonly<Record<string, unknown>> {
  if (!addedContext) {
    return context;
  }
  for (const key of Object.keys(addedContext)) {
    if (key in context) {
      throw new TypeError(
        `RSC middleware cannot overwrite context key "${key}".`
      );
    }
  }
  return { ...context, ...addedContext };
}

export function prepareRscServerMiddleware(
  middleware: readonly RscMiddleware[]
): readonly PreparedRscServerMiddleware[] {
  return Object.freeze(
    middleware.map((candidate) => {
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        !(MIDDLEWARE_DEFINITION in candidate)
      ) {
        throw new TypeError(
          'Expected middleware created by createMiddleware().'
        );
      }
      return Object.freeze({
        callback: (candidate as InternalMiddleware)[MIDDLEWARE_DEFINITION]
          .server,
      });
    })
  );
}

export async function runPreparedServerMiddleware<Value>(
  middleware: readonly PreparedRscServerMiddleware[],
  input: {
    readonly context: Readonly<Record<string, unknown>>;
    readonly request: Request;
    readonly signal: AbortSignal;
  },
  terminal: (
    context: Readonly<Record<string, unknown>>
  ) => Promise<Value> | Value
): Promise<Value> {
  const run = async (
    index: number,
    context: Readonly<Record<string, unknown>>
  ): Promise<RscMiddlewareResult<object, Value>> => {
    const current = middleware[index];
    if (!current) {
      return {
        [MIDDLEWARE_RESULT]: true,
        context,
        value: await terminal(context),
      };
    }
    const callback = current.callback;
    if (!callback) {
      return run(index + 1, context);
    }
    return callback({
      context,
      next: (async (options?: RscServerMiddlewareNextOptions<object>) =>
        run(
          index + 1,
          mergeContext(context, options?.context)
        )) as RscServerMiddlewareInput<unknown>['next'],
      request: input.request,
      signal: input.signal,
    }) as Promise<RscMiddlewareResult<object, Value>>;
  };

  return (await run(0, input.context)).value;
}
