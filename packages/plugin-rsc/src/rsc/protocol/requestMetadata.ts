import { RscCompatibilityError, RscRequestError } from '../errors/index.js';

export const RSC_PROTOCOL_VERSION = 1 as const;

export const RSC_REQUEST_HEADERS = Object.freeze({
  kind: 'x-repack-rsc-kind',
  platform: 'x-repack-rsc-platform',
  protocolVersion: 'x-repack-rsc-protocol-version',
  runtimeVersion: 'x-repack-rsc-runtime-version',
  unit: 'x-repack-rsc-unit',
});

export type RscRequestKind = 'render' | 'action';

type RscEncodedRequestBody = FormData | URLSearchParams | string;
type RscFlightReplyBody = Awaited<ReturnType<Request['formData']>> | string;

interface RscRequestContext {
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly unit: string;
}

interface RscRequestInputBase {
  readonly context: RscRequestContext;
  readonly id: string;
  readonly signal: AbortSignal;
}

type CreateRscProtocolRequestInput =
  | (RscRequestInputBase & {
      readonly data: unknown;
      readonly headers?: HeadersInit;
      readonly kind: 'action';
    })
  | (RscRequestInputBase & {
      readonly kind: 'render';
      readonly props: unknown;
    });

type EncodeRscRequest = (
  value: unknown,
  options: { readonly signal: AbortSignal }
) => PromiseLike<RscEncodedRequestBody>;

/** Builds the complete application-transport request for one RSC frame. */
export async function createRscProtocolRequest(
  input: CreateRscProtocolRequestInput,
  encode: EncodeRscRequest
): Promise<Readonly<{ kind: RscRequestKind; init: RequestInit }>> {
  const frame =
    input.kind === 'action'
      ? { data: input.data, id: input.id }
      : { id: input.id, props: input.props };
  const body = await encode(frame, { signal: input.signal });

  return {
    init: {
      body,
      headers: createProtocolHeaders(
        input.context,
        input.kind,
        input.kind === 'action' ? input.headers : undefined
      ),
      method: 'POST',
      signal: input.signal,
    },
    kind: input.kind,
  };
}

interface ParseRscProtocolRequestOptions {
  readonly decodeReply: (
    body: RscFlightReplyBody,
    serverManifest: Readonly<Record<string, unknown>>
  ) => PromiseLike<unknown>;
  readonly platforms: readonly string[];
  readonly runtimeVersion: string;
  readonly unit: string;
}

interface RscRequestFrame {
  readonly data?: unknown;
  readonly id: string;
  readonly props?: unknown;
}

interface ParsedRscProtocolRequest {
  readonly frame: RscRequestFrame;
  readonly kind: RscRequestKind;
  readonly platform: string;
}

interface RscParsedRequestMetadata {
  readonly kind: RscRequestKind;
  readonly platform: string;
  readonly protocolVersion: number | undefined;
  readonly runtimeVersion: string | null;
  readonly unit: string | null;
}

/** Validates and decodes an incoming RSC request before application code runs. */
export async function parseRscProtocolRequest(
  request: Request,
  options: ParseRscProtocolRequestOptions
): Promise<ParsedRscProtocolRequest> {
  const metadata = parseRequestMetadata(request);
  validateRequestCompatibility(metadata, options);
  let decodedFrame: unknown;
  try {
    const body = await readReplyBody(request);
    decodedFrame = await options.decodeReply(body, {});
  } catch {
    throw createInvalidRequestBodyError();
  }
  const frame = parseRequestFrame(decodedFrame);

  return {
    frame,
    kind: metadata.kind,
    platform: metadata.platform,
  };
}

function createInvalidRequestBodyError(): RscRequestError {
  return new RscRequestError({
    code: 'RSC_PROTOCOL_ERROR',
    message: 'RSC request body is invalid.',
    status: 400,
  });
}

function createProtocolHeaders(
  context: RscRequestContext,
  kind: RscRequestKind,
  additional?: HeadersInit
): Headers {
  const headers = new Headers(additional);
  headers.set('accept', 'text/x-component');
  headers.set(RSC_REQUEST_HEADERS.kind, kind);
  headers.set(RSC_REQUEST_HEADERS.platform, context.platform);
  headers.set(
    RSC_REQUEST_HEADERS.protocolVersion,
    String(RSC_PROTOCOL_VERSION)
  );
  headers.set(RSC_REQUEST_HEADERS.runtimeVersion, context.runtimeVersion);
  headers.set(RSC_REQUEST_HEADERS.unit, context.unit);
  return headers;
}

function parseRequestMetadata(request: Request): RscParsedRequestMetadata {
  if (request.method !== 'POST') {
    throw new RscRequestError({
      code: 'RSC_METHOD_NOT_ALLOWED',
      message: 'RSC requests must use POST.',
      status: 405,
    });
  }

  const kind = request.headers.get(RSC_REQUEST_HEADERS.kind);
  if (kind !== 'action' && kind !== 'render') {
    throw new RscRequestError({
      code: 'RSC_PROTOCOL_ERROR',
      message: 'RSC request kind must be "render" or "action".',
      status: 400,
    });
  }

  const protocolHeader = request.headers.get(
    RSC_REQUEST_HEADERS.protocolVersion
  );
  const protocolVersion = protocolHeader ? Number(protocolHeader) : undefined;

  return {
    kind,
    platform: request.headers.get(RSC_REQUEST_HEADERS.platform) ?? '',
    protocolVersion:
      protocolVersion !== undefined && Number.isInteger(protocolVersion)
        ? protocolVersion
        : undefined,
    runtimeVersion: request.headers.get(RSC_REQUEST_HEADERS.runtimeVersion),
    unit: request.headers.get(RSC_REQUEST_HEADERS.unit),
  };
}

function validateRequestCompatibility(
  metadata: RscParsedRequestMetadata,
  options: Pick<
    ParseRscProtocolRequestOptions,
    'platforms' | 'runtimeVersion' | 'unit'
  >
): void {
  if (metadata.protocolVersion !== RSC_PROTOCOL_VERSION) {
    throw new RscCompatibilityError({
      expected: RSC_PROTOCOL_VERSION,
      reason: 'protocolVersion',
      ...(metadata.protocolVersion !== undefined && {
        received: metadata.protocolVersion,
      }),
    });
  }
  if (metadata.unit !== options.unit) {
    throw new RscCompatibilityError({
      expected: options.unit,
      reason: 'unit',
      ...(metadata.unit !== null && { received: metadata.unit }),
    });
  }
  if (metadata.runtimeVersion !== options.runtimeVersion) {
    throw new RscCompatibilityError({
      expected: options.runtimeVersion,
      reason: 'runtimeVersion',
      ...(metadata.runtimeVersion !== null && {
        received: metadata.runtimeVersion,
      }),
    });
  }
  if (!options.platforms.includes(metadata.platform)) {
    throw new RscCompatibilityError({
      expected: [...options.platforms].sort().join(','),
      reason: 'platform',
      ...(metadata.platform !== '' && { received: metadata.platform }),
    });
  }
}

function parseRequestFrame(value: unknown): RscRequestFrame {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { readonly id?: unknown }).id !== 'string'
  ) {
    throw createInvalidRequestBodyError();
  }
  return value as RscRequestFrame;
}

async function readReplyBody(request: Request): Promise<RscFlightReplyBody> {
  const contentType = request.headers.get('content-type')?.toLowerCase();
  if (
    contentType?.startsWith('multipart/form-data') ||
    contentType?.startsWith('application/x-www-form-urlencoded')
  ) {
    return request.formData();
  }
  return request.text();
}
