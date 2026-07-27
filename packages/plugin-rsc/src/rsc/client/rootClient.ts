import { RscRequestError } from '../errors/index.js';
import { parseRscProblemResponse } from '../protocol/problemDetails.js';
import { createRscProtocolRequest } from '../protocol/requestMetadata.js';
import type {
  RscRuntimeConfig,
  RscTransportContext,
  RscTransportRequest,
} from '../runtime/index.js';
import {
  type RscRootRenderResult,
  failedRscRootFlightDecode,
  failedRscRootRequest,
  failedRscRootTransport,
  successfulRscRootRender,
} from './rootRenderResult.js';
import { createRscTransportLifecycle } from './transportLifecycle.js';

export type RscEncodedReply = FormData | URLSearchParams | string;

export interface RscFlightClientCodec {
  readonly decode: (body: ReadableStream<Uint8Array>) => PromiseLike<unknown>;
  readonly encode: (
    value: unknown,
    options: { readonly signal: AbortSignal }
  ) => Promise<RscEncodedReply>;
}

export interface CreateRscRootClientInput extends RscFlightClientCodec {
  readonly config: RscRuntimeConfig;
  readonly context: RscTransportContext;
}

export interface RscRootRenderInput<Props extends object> {
  readonly id: string;
  readonly props: Props;
  readonly signal: AbortSignal;
}

export interface RscServerFunctionCallInput<Data> {
  readonly data: Data;
  readonly headers?: HeadersInit;
  readonly id: string;
  readonly signal: AbortSignal;
}

export interface RscActionClient {
  call<Data, Result>(input: RscServerFunctionCallInput<Data>): Promise<Result>;
}

export interface RscRootClient<FlightTree = unknown> {
  dispose(): Promise<void>;
  render<Props extends object>(
    input: RscRootRenderInput<Props>
  ): Promise<RscRootRenderResult<FlightTree>>;
}

export interface RscClient<FlightTree = unknown>
  extends RscActionClient,
    RscRootClient<FlightTree> {}

export function createRscRootClient<FlightTree = unknown>(
  input: CreateRscRootClientInput
): RscClient<FlightTree> {
  const transport = createRscTransportLifecycle({
    config: input.config,
    context: input.context,
  });
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  function assertActive(): void {
    if (disposed) {
      throw new DOMException(
        `RSC client runtime for "${input.context.unit}" was replaced or disposed.`,
        'AbortError'
      );
    }
  }

  async function awaitActive<Value>(value: PromiseLike<Value>): Promise<Value> {
    try {
      const result = await value;
      assertActive();
      return result;
    } catch (error) {
      assertActive();
      throw error;
    }
  }

  return {
    async call<Data, Result>(
      callInput: RscServerFunctionCallInput<Data>
    ): Promise<Result> {
      assertActive();
      const request = await awaitActive(
        createRscProtocolRequest(
          {
            context: input.context,
            data: callInput.data,
            headers: callInput.headers,
            id: callInput.id,
            kind: 'action',
            signal: callInput.signal,
          },
          input.encode
        )
      );
      const response = await awaitActive(transport.fetch(request));
      if (!response.ok) {
        const error = await awaitActive(parseRscProblemResponse(response));
        throw error;
      }
      if (!response.body) {
        throw new RscRequestError({
          code: 'RSC_PROTOCOL_ERROR',
          message: 'RSC Flight response has no readable body.',
          status: 502,
        });
      }
      return (await awaitActive(input.decode(response.body))) as Result;
    },

    dispose: () => {
      if (disposePromise) {
        return disposePromise;
      }
      disposed = true;
      disposePromise = transport.dispose();
      return disposePromise;
    },

    async render<Props extends object>(
      renderInput: RscRootRenderInput<Props>
    ): Promise<RscRootRenderResult<FlightTree>> {
      let request: RscTransportRequest;
      try {
        assertActive();
        request = await awaitActive(
          createRscProtocolRequest(
            {
              context: input.context,
              id: renderInput.id,
              kind: 'render',
              props: renderInput.props,
              signal: renderInput.signal,
            },
            input.encode
          )
        );
      } catch (error) {
        return failedRscRootRequest(error);
      }

      let response: Response;
      try {
        response = await awaitActive(transport.fetch(request));
      } catch (error) {
        return failedRscRootTransport(error);
      }

      if (!response.ok) {
        try {
          return failedRscRootRequest(
            await awaitActive(parseRscProblemResponse(response))
          );
        } catch (error) {
          return failedRscRootRequest(error);
        }
      }

      if (!response.body) {
        return failedRscRootFlightDecode(
          new Error('RSC Flight response has no readable body.')
        );
      }

      try {
        const tree = await input.decode(response.body);
        assertActive();
        return successfulRscRootRender(tree as FlightTree);
      } catch (error) {
        try {
          assertActive();
        } catch (lifecycleError) {
          return failedRscRootRequest(lifecycleError);
        }
        return failedRscRootFlightDecode(error);
      }
    },
  };
}
