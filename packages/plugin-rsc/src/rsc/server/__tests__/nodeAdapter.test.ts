import { once } from 'node:events';
import http from 'node:http';
import type { RscHandler } from '../handler.js';
import { toNodeMiddleware } from '../nodeAdapter.js';

describe('toNodeMiddleware', () => {
  it('streams a raw Node request through the Web handler and streams its response', async () => {
    let handlerSignal: AbortSignal | undefined;
    let notifyHandlerStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      notifyHandlerStarted = resolve;
    });
    let notifyFirstUploadRead!: () => void;
    const firstUploadRead = new Promise<void>((resolve) => {
      notifyFirstUploadRead = resolve;
    });
    let notifyFirstResponseRead!: () => void;
    const firstResponseRead = new Promise<void>((resolve) => {
      notifyFirstResponseRead = resolve;
    });
    let releaseSecondChunk!: () => void;
    const secondChunk = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    const handler = jest.fn(async (request: Request): Promise<Response> => {
      notifyHandlerStarted();
      handlerSignal = request.signal;
      expect(request.url).toBe('http://rsc.internal/render?team=callstack');
      expect(request.method).toBe('POST');
      const reader = request.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('encoded-');
      notifyFirstUploadRead();
      const second = await reader.read();
      expect(new TextDecoder().decode(second.value)).toBe('flight');
      await expect(reader.read()).resolves.toMatchObject({ done: true });
      const headers = new Headers({
        'content-type': 'text/x-component',
        'x-rsc-result': 'streamed',
      });
      headers.append('set-cookie', 'first=1; Path=/');
      headers.append('set-cookie', 'second=2; Path=/');
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('flight:'));
            await secondChunk;
            controller.enqueue(new TextEncoder().encode('ready'));
            controller.close();
          },
        }),
        {
          headers,
          status: 201,
        }
      );
    });
    const server = http.createServer(toNodeMiddleware(handler));
    const address = await listen(server);

    const exchange = openRequest(
      address,
      {
        headers: { host: 'rsc.internal' },
        method: 'POST',
        path: '/render?team=callstack',
      },
      notifyFirstResponseRead
    );
    exchange.clientRequest.write('encoded-');
    await handlerStarted;
    expect(handler).toHaveBeenCalledTimes(1);
    await firstUploadRead;
    exchange.clientRequest.end('flight');
    await firstResponseRead;
    releaseSecondChunk();
    const response = await exchange.response;

    expect(response).toEqual({
      body: 'flight:ready',
      headers: expect.objectContaining({
        'content-type': 'text/x-component',
        'set-cookie': ['first=1; Path=/', 'second=2; Path=/'],
        'x-rsc-result': 'streamed',
      }),
      status: 201,
    });
    expect(handlerSignal?.aborted).toBe(false);
    await close(server);
  });

  it('ignores forwarded origin headers by default', async () => {
    const handler: RscHandler = async (request) =>
      new Response(request.url, { headers: { 'content-type': 'text/plain' } });
    const server = http.createServer(toNodeMiddleware(handler));
    const address = await listen(server);

    const response = await request(address, {
      headers: {
        host: 'private.internal:8080',
        'x-forwarded-host': 'public.example',
        'x-forwarded-proto': 'https',
      },
      method: 'GET',
      path: '/render',
    });

    expect(response.body).toBe('http://private.internal:8080/render');
    await close(server);
  });

  it('lets the application resolve a trusted proxy origin explicitly', async () => {
    const handler: RscHandler = async (request) => new Response(request.url);
    const server = http.createServer(
      toNodeMiddleware(handler, {
        resolveOrigin(request) {
          return `${String(request.headers['x-forwarded-proto'])}://${String(
            request.headers['x-forwarded-host']
          )}`;
        },
      })
    );
    const address = await listen(server);

    const response = await request(address, {
      headers: {
        host: 'private.internal',
        'x-forwarded-host': 'public.example',
        'x-forwarded-proto': 'https',
      },
      method: 'GET',
      path: '/render',
    });

    expect(response.body).toBe('https://public.example/render');
    await close(server);
  });

  it('aborts the Web request when the client disconnects', async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let notifyAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      notifyAborted = resolve;
    });
    const handler: RscHandler = async (request) => {
      notifyStarted();
      await new Promise<void>((resolve) => {
        request.signal.addEventListener(
          'abort',
          () => {
            notifyAborted();
            resolve();
          },
          { once: true }
        );
      });
      return new Response(null);
    };
    const server = http.createServer(toNodeMiddleware(handler));
    const address = await listen(server);
    const clientRequest = http.request({
      headers: { 'content-length': '100' },
      host: address.host,
      method: 'POST',
      path: '/render',
      port: address.port,
    });
    clientRequest.on('error', () => undefined);
    clientRequest.write('partial-body');

    await started;
    clientRequest.destroy();
    await aborted;

    await close(server);
  });

  it('aborts after a completed upload when the response connection closes early', async () => {
    let notifyAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      notifyAborted = resolve;
    });
    const handler: RscHandler = async (request) => {
      request.signal.addEventListener('abort', notifyAborted, { once: true });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first-chunk'));
          },
        })
      );
    };
    const server = http.createServer(toNodeMiddleware(handler));
    const address = await listen(server);
    const clientRequest = http.request({
      host: address.host,
      method: 'GET',
      path: '/render',
      port: address.port,
    });
    clientRequest.on('error', () => undefined);
    clientRequest.on('response', (response) => {
      response.once('data', () => response.destroy());
    });
    clientRequest.end();

    await aborted;

    await close(server);
  });

  it('rejects a request target that can replace the resolved origin', async () => {
    const handler = jest.fn(async () => new Response('unreachable'));
    const server = http.createServer(toNodeMiddleware(handler));
    const address = await listen(server);

    const response = await request(address, {
      method: 'GET',
      path: '//evil.example/render',
    });

    expect(response.status).toBe(400);
    expect(response.body).toBe('Bad Request');
    expect(handler).not.toHaveBeenCalled();
    await close(server);
  });

  it('rejects a resolved origin containing a path', async () => {
    const handler = jest.fn(async () => new Response('unreachable'));
    const server = http.createServer(
      toNodeMiddleware(handler, {
        resolveOrigin: () => 'https://public.example/base',
      })
    );
    const address = await listen(server);

    const response = await request(address, {
      method: 'GET',
      path: '/render',
    });

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    await close(server);
  });

  it('contains a handler rejection before Node response headers start', async () => {
    const server = http.createServer(
      toNodeMiddleware(async () => {
        throw new Error('private server failure');
      })
    );
    const address = await listen(server);

    const response = await request(address, {
      method: 'GET',
      path: '/render',
    });

    expect(response).toMatchObject({
      body: 'Internal Server Error',
      status: 500,
    });
    await close(server);
  });

  it('keeps cookies separate without Headers.getSetCookie', async () => {
    const headersPrototype = Headers.prototype as unknown as {
      getSetCookie?: () => string[];
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      headersPrototype,
      'getSetCookie'
    );
    Object.defineProperty(headersPrototype, 'getSetCookie', {
      configurable: true,
      value: undefined,
    });
    const handler: RscHandler = async () => {
      const headers = new Headers();
      headers.append(
        'set-cookie',
        'first=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/'
      );
      headers.append('set-cookie', 'second=2; Path=/');
      return new Response(null, { headers });
    };
    const server = http.createServer(toNodeMiddleware(handler));
    try {
      const address = await listen(server);

      const response = await request(address, {
        method: 'GET',
        path: '/render',
      });

      expect(response.headers['set-cookie']).toEqual([
        'first=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
        'second=2; Path=/',
      ]);
    } finally {
      await close(server);
      if (descriptor) {
        Object.defineProperty(headersPrototype, 'getSetCookie', descriptor);
      } else {
        delete headersPrototype.getSetCookie;
      }
    }
  });
});

interface TestAddress {
  readonly host: string;
  readonly port: number;
}

async function listen(server: http.Server): Promise<TestAddress> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address.');
  }
  return { host: '127.0.0.1', port: address.port };
}

async function close(server: http.Server): Promise<void> {
  server.close();
  await once(server, 'close');
}

async function request(
  address: TestAddress,
  options: {
    readonly body?: readonly string[];
    readonly headers?: http.OutgoingHttpHeaders;
    readonly method: string;
    readonly path: string;
  }
): Promise<TestResponse> {
  const exchange = openRequest(address, options);
  for (const chunk of options.body ?? []) {
    exchange.clientRequest.write(chunk);
  }
  exchange.clientRequest.end();
  return exchange.response;
}

interface TestResponse {
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly status: number | undefined;
}

function openRequest(
  address: TestAddress,
  options: {
    readonly headers?: http.OutgoingHttpHeaders;
    readonly method: string;
    readonly path: string;
  },
  onFirstData?: () => void
): {
  readonly clientRequest: http.ClientRequest;
  readonly response: Promise<TestResponse>;
} {
  let clientRequest!: http.ClientRequest;
  const response = new Promise<TestResponse>((resolve, reject) => {
    clientRequest = http.request(
      {
        headers: options.headers,
        host: address.host,
        method: options.method,
        path: options.path,
        port: address.port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let first = true;
        response.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
          if (first) {
            first = false;
            onFirstData?.();
          }
        });
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: response.headers,
            status: response.statusCode,
          });
        });
      }
    );
    clientRequest.on('error', reject);
  });
  return { clientRequest, response };
}
