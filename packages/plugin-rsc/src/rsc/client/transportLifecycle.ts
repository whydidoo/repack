import type {
  RscRuntimeConfig,
  RscTransport,
  RscTransportContext,
  RscTransportRequest,
} from '../runtime/index.js';

export interface CreateRscTransportLifecycleInput {
  readonly config: RscRuntimeConfig;
  readonly context: RscTransportContext;
}

export interface RscTransportLifecycle {
  fetch(request: RscTransportRequest): Promise<Response>;
  dispose(): Promise<void>;
}

export function createRscTransportLifecycle(
  input: CreateRscTransportLifecycleInput
): RscTransportLifecycle {
  let disposed = false;
  let disposePromise: Promise<void> | undefined;
  let initialization: Promise<RscTransport> | undefined;
  let transport: RscTransport | undefined;

  function getTransport(): Promise<RscTransport> {
    if (disposed) {
      return Promise.reject(
        new Error(
          `RSC transport lifecycle for "${input.context.unit}" has been disposed.`
        )
      );
    }
    if (transport) {
      return Promise.resolve(transport);
    }
    if (initialization) {
      return initialization;
    }

    const currentInitialization = Promise.resolve()
      .then(() => input.config.createTransport(input.context))
      .then(
        (createdTransport) => {
          transport = createdTransport;
          if (initialization === currentInitialization) {
            initialization = undefined;
          }
          return createdTransport;
        },
        (error: unknown) => {
          if (initialization === currentInitialization) {
            initialization = undefined;
          }
          throw error;
        }
      );
    initialization = currentInitialization;
    return currentInitialization;
  }

  return {
    async dispose(): Promise<void> {
      if (disposePromise) {
        return disposePromise;
      }
      disposed = true;
      const pendingInitialization = initialization;
      disposePromise = (async () => {
        const initializedTransport =
          transport ?? (await pendingInitialization?.catch(() => undefined));
        try {
          await initializedTransport?.dispose?.();
        } finally {
          transport = undefined;
          initialization = undefined;
        }
      })();
      return disposePromise;
    },

    async fetch(request: RscTransportRequest): Promise<Response> {
      const initializedTransport = await getTransport();
      const response = await initializedTransport.fetch(request);
      return normalizeBufferedResponse(response);
    },
  };
}

async function normalizeBufferedResponse(
  response: Response
): Promise<Response> {
  if (response.body !== null && response.body !== undefined) {
    return response;
  }
  if (
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    return response;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const normalizedResponse = new Response(bytes.slice().buffer, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
  Object.defineProperty(normalizedResponse, 'body', {
    configurable: true,
    enumerable: true,
    value: createOnePartReadableStream(bytes),
  });
  return normalizedResponse;
}

function createOnePartReadableStream(
  bytes: Uint8Array
): ReadableStream<Uint8Array> {
  let locked = false;
  let cancelled = false;

  return {
    cancel() {
      cancelled = true;
      return Promise.resolve();
    },
    get locked() {
      return locked;
    },
    getReader() {
      if (locked) {
        throw new TypeError('RSC buffered response stream is already locked.');
      }
      locked = true;
      let delivered = false;
      return {
        cancel() {
          cancelled = true;
          return Promise.resolve();
        },
        closed: Promise.resolve(undefined),
        read() {
          if (cancelled || delivered) {
            return Promise.resolve({ done: true, value: undefined });
          }
          delivered = true;
          return Promise.resolve({ done: false, value: bytes });
        },
        releaseLock() {
          locked = false;
        },
      } as ReadableStreamDefaultReader<Uint8Array>;
    },
  } as ReadableStream<Uint8Array>;
}
