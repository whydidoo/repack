export interface RscClientMiddlewareNextOptions {
  readonly headers?: HeadersInit;
}

export interface RscClientMiddlewareResult<Value = unknown> {
  readonly value: Value;
}

export interface RscClientMiddlewareInput {
  readonly next: (
    options?: RscClientMiddlewareNextOptions
  ) => Promise<RscClientMiddlewareResult>;
}

export type RscClientMiddlewareCallback = (
  input: RscClientMiddlewareInput
) => Promise<RscClientMiddlewareResult>;

export interface RscClientMiddleware {
  readonly callback: RscClientMiddlewareCallback;
}

export interface RscClientMiddlewareBuilder {
  client(callback: RscClientMiddlewareCallback): RscClientMiddleware;
}

export function createClientMiddleware(): RscClientMiddlewareBuilder {
  return {
    client: (callback) => ({ callback }),
  };
}

export async function runClientMiddleware<Result>(
  middleware: readonly RscClientMiddleware[],
  terminal: (headers: Headers) => Promise<Result>
): Promise<Result> {
  const run = async (
    index: number,
    headers: Headers
  ): Promise<RscClientMiddlewareResult> => {
    const current = middleware[index];
    if (!current) {
      return { value: await terminal(headers) };
    }
    if (typeof current.callback !== 'function') {
      throw new TypeError(
        'Expected client middleware created by createMiddleware().client().'
      );
    }
    return current.callback({
      next: (options) =>
        run(index + 1, mergeHeaders(headers, options?.headers)),
    });
  };

  return (await run(0, new Headers())).value as Result;
}

function mergeHeaders(current: Headers, added?: HeadersInit): Headers {
  const merged = new Headers(current);
  new Headers(added).forEach((value, name) => merged.set(name, value));
  return merged;
}
