import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RscHandler } from './handler.js';

export interface RscNodeRequest {
  readonly aborted: boolean;
  readonly complete: boolean;
  readonly headers: Readonly<
    Record<string, readonly string[] | string | undefined>
  >;
  readonly method?: string;
  readonly rawHeaders: readonly string[];
  readonly socket: object;
  readonly url?: string;
  off(event: 'aborted' | 'close', listener: () => void): this;
  once(event: 'aborted' | 'close', listener: () => void): this;
}

export interface RscNodeResponse {
  readonly destroyed: boolean;
  readonly headersSent: boolean;
  statusCode: number;
  statusMessage: string;
  readonly writableFinished: boolean;
  destroy(error?: Error): this;
  end(body?: string): this;
  off(event: 'close', listener: () => void): this;
  once(event: 'close', listener: () => void): this;
  setHeader(name: string, value: number | readonly string[] | string): this;
}

export interface RscNodeMiddlewareOptions {
  /**
   * Resolves the trusted HTTP origin. Forwarded headers are ignored by
   * default; applications behind a trusted proxy may read them here.
   */
  readonly resolveOrigin?: (request: RscNodeRequest) => string | URL;
}

export type RscNodeMiddleware = (
  request: RscNodeRequest,
  response: RscNodeResponse
) => void;

export function toNodeMiddleware(
  handler: RscHandler,
  options: RscNodeMiddlewareOptions = {}
): RscNodeMiddleware {
  return (request, response) => {
    void dispatchNodeRequest(handler, options, request, response);
  };
}

async function dispatchNodeRequest(
  handler: RscHandler,
  options: RscNodeMiddlewareOptions,
  nodeRequest: RscNodeRequest,
  nodeResponse: RscNodeResponse
): Promise<void> {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException('The HTTP connection was closed.', 'AbortError')
      );
    }
  };
  const onRequestClose = () => {
    if (nodeRequest.aborted || !nodeRequest.complete) {
      abort();
    }
  };
  const onResponseClose = () => {
    if (!nodeResponse.writableFinished) {
      abort();
    }
  };
  nodeRequest.once('aborted', abort);
  nodeRequest.once('close', onRequestClose);
  nodeResponse.once('close', onResponseClose);

  try {
    const request = createWebRequest(nodeRequest, controller.signal, options);
    const response = await handler(request);
    await writeWebResponse(
      response,
      nodeResponse,
      controller.signal,
      request.method === 'HEAD'
    );
  } catch (error) {
    if (!controller.signal.aborted && !nodeResponse.destroyed) {
      writeAdapterError(nodeResponse, error);
    }
  } finally {
    nodeRequest.off('aborted', abort);
    nodeRequest.off('close', onRequestClose);
    nodeResponse.off('close', onResponseClose);
  }
}

function createWebRequest(
  request: RscNodeRequest,
  signal: AbortSignal,
  options: RscNodeMiddlewareOptions
): Request {
  const method = request.method?.toUpperCase() ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = {
    headers: createWebHeaders(request.rawHeaders),
    method,
    signal,
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(
      request as unknown as Readable
    ) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  return new Request(createAbsoluteRequestUrl(request, options), init);
}

function createWebHeaders(rawHeaders: readonly string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) {
      headers.append(name, value);
    }
  }
  return headers;
}

function createAbsoluteRequestUrl(
  request: RscNodeRequest,
  options: RscNodeMiddlewareOptions
): URL {
  const requestTarget = request.url ?? '/';
  if (!requestTarget.startsWith('/') || requestTarget.startsWith('//')) {
    throw new RscNodeAdapterRequestError(
      'The Node request target must use origin-form.'
    );
  }
  const configuredOrigin = options.resolveOrigin
    ? options.resolveOrigin(request)
    : createDirectOrigin(request);
  let origin: URL;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    throw new RscNodeAdapterRequestError(
      'The resolved Node request origin must be an absolute URL.'
    );
  }
  if (
    (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new RscNodeAdapterRequestError(
      'The resolved Node request origin must contain only an HTTP(S) authority.'
    );
  }
  const url = new URL(requestTarget, origin);
  if (url.origin !== origin.origin) {
    throw new RscNodeAdapterRequestError(
      'The Node request target cannot replace the resolved origin.'
    );
  }
  return url;
}

function createDirectOrigin(request: RscNodeRequest): string {
  const host = request.headers.host;
  if (typeof host !== 'string' || host.trim() === '') {
    throw new RscNodeAdapterRequestError(
      'The Node request must include a Host header.'
    );
  }
  const encrypted = (request.socket as { readonly encrypted?: unknown })
    .encrypted;
  return `${encrypted === true ? 'https' : 'http'}://${host}`;
}

async function writeWebResponse(
  response: Response,
  nodeResponse: RscNodeResponse,
  signal: AbortSignal,
  headRequest: boolean
): Promise<void> {
  nodeResponse.statusCode = response.status;
  if (response.statusText !== '') {
    nodeResponse.statusMessage = response.statusText;
  }
  writeWebHeaders(response.headers, nodeResponse);

  if (!response.body || headRequest) {
    if (headRequest) {
      await response.body?.cancel();
    }
    nodeResponse.end();
    return;
  }

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    nodeResponse as unknown as Writable,
    { signal }
  );
}

function writeWebHeaders(headers: Headers, response: RscNodeResponse): void {
  for (const [name, value] of headers) {
    if (name !== 'set-cookie') {
      response.setHeader(name, value);
    }
  }
  const getSetCookie = (
    headers as Headers & { readonly getSetCookie?: () => string[] }
  ).getSetCookie;
  const combinedSetCookie = headers.get('set-cookie');
  const setCookie =
    getSetCookie?.call(headers) ??
    (combinedSetCookie ? splitCombinedSetCookieHeader(combinedSetCookie) : []);
  if (setCookie.length > 0) {
    response.setHeader('set-cookie', setCookie);
  }
}

function splitCombinedSetCookieHeader(header: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  for (let index = 0; index < header.length; index += 1) {
    if (header[index] !== ',') {
      continue;
    }
    let cursor = index + 1;
    while (header[cursor] === ' ' || header[cursor] === '\t') {
      cursor += 1;
    }
    while (
      cursor < header.length &&
      header[cursor] !== '=' &&
      header[cursor] !== ';' &&
      header[cursor] !== ','
    ) {
      cursor += 1;
    }
    if (header[cursor] === '=') {
      cookies.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  cookies.push(header.slice(start).trim());
  return cookies;
}

function writeAdapterError(response: RscNodeResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  response.statusCode =
    error instanceof RscNodeAdapterRequestError ? error.status : 500;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(
    error instanceof RscNodeAdapterRequestError
      ? 'Bad Request'
      : 'Internal Server Error'
  );
}

class RscNodeAdapterRequestError extends Error {
  readonly status = 400;
}
