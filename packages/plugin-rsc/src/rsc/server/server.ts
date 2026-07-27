import {
  type RscProblemDetails,
  toRscProblemDetails,
} from '../protocol/problemDetails.js';
import type { RscMiddleware, RscMiddlewareContext } from './middleware.js';
import type { RscServerDefinition } from './registration.js';

const RSC_SERVER_DEFINITION = Symbol('repack.rsc.server.definition');

export interface RscCreateContextInput {
  readonly request: Request;
  readonly signal: AbortSignal;
}

export interface RscServerErrorInfo {
  readonly digest: string;
  readonly request: Request;
}

export interface RscServerOptions<
  Context extends object,
  Middleware extends readonly RscMiddleware[] = readonly [],
> {
  readonly createContext: (
    input: RscCreateContextInput
  ) => Context | Promise<Context>;
  readonly middleware?: Middleware;
  readonly onError?: (
    error: unknown,
    info: RscServerErrorInfo
  ) => void | Promise<void>;
}

type InternalRscServerDefinition<Context extends object> =
  RscServerDefinition<Context> & {
    readonly [RSC_SERVER_DEFINITION]: {
      readonly createContext: (
        input: RscCreateContextInput
      ) => object | Promise<object>;
      readonly middleware: readonly RscMiddleware[];
      readonly onError?: (
        error: unknown,
        info: RscServerErrorInfo
      ) => void | Promise<void>;
    };
  };

export type RscServerImplementation =
  InternalRscServerDefinition<object>[typeof RSC_SERVER_DEFINITION];

export function getRscServerImplementation<Context extends object>(
  server: RscServerDefinition<Context>
): InternalRscServerDefinition<Context>[typeof RSC_SERVER_DEFINITION] {
  const definition = server as InternalRscServerDefinition<Context>;
  if (!(RSC_SERVER_DEFINITION in definition)) {
    throw new TypeError('Expected a server created by defineRscServer().');
  }

  return definition[RSC_SERVER_DEFINITION];
}

export function defineRscServer<
  Context extends object,
  const Middleware extends readonly RscMiddleware[] = readonly [],
>(
  options: RscServerOptions<Context, Middleware>
): RscServerDefinition<Context & RscMiddlewareContext<Middleware>> {
  const definition: InternalRscServerDefinition<
    Context & RscMiddlewareContext<Middleware>
  > = {
    [RSC_SERVER_DEFINITION]: Object.freeze({
      createContext: options.createContext,
      middleware: Object.freeze([...(options.middleware ?? [])]),
      onError: options.onError,
    }),
  };
  return Object.freeze(definition);
}

export interface HandleRscServerErrorInput extends RscServerErrorInfo {
  readonly development: boolean;
}

export async function handleRscServerImplementationError(
  implementation: RscServerImplementation,
  error: unknown,
  input: HandleRscServerErrorInput
): Promise<RscProblemDetails> {
  try {
    await implementation.onError?.(error, {
      digest: input.digest,
      request: input.request,
    });
  } catch {
    // Diagnostics must not replace the original failure or bypass redaction.
  }

  return toRscProblemDetails(
    error,
    input.development
      ? { development: true }
      : { development: false, digest: input.digest }
  );
}
