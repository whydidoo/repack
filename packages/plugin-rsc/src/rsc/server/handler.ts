import type {
  RscClientReferenceContract,
  RscPlatformManifest,
} from '../artifacts/types.js';
import {
  RscRequestError,
  isRscCompatibilityError,
  isRscRequestError,
} from '../errors/index.js';
import {
  type RscProblemDetails,
  toRscProblemDetails,
} from '../protocol/problemDetails.js';
import { parseRscProtocolRequest } from '../protocol/requestMetadata.js';
import {
  type PreparedRscServerMiddleware,
  prepareRscServerMiddleware,
  runPreparedServerMiddleware,
} from './middleware.js';
import type { RscServerDefinition } from './registration.js';
import { prepareRscRoot } from './root.js';
import {
  getRscServerImplementation,
  handleRscServerImplementationError,
} from './server.js';
import { prepareServerFn } from './serverFunction.js';

type RscFlightReplyBody = Awaited<ReturnType<Request['formData']>> | string;

interface RscFlightRenderOptions {
  readonly onError: (error: unknown) => string;
  readonly signal: AbortSignal;
}

export interface RscHandlerDependencies {
  readonly createDigest: (error: unknown) => string;
  readonly decodeReply: (
    body: RscFlightReplyBody,
    serverManifest: Readonly<Record<string, unknown>>
  ) => PromiseLike<unknown>;
  readonly render: (
    model: unknown,
    clientManifest: Readonly<Record<string, unknown>>,
    options: RscFlightRenderOptions
  ) => ReadableStream<Uint8Array>;
}

export interface CreateRscHandlerOptions<Context extends object> {
  readonly development: boolean;
  readonly platformManifests: readonly RscPlatformManifest[];
  readonly roots: ReadonlyMap<string, unknown>;
  readonly runtimeVersion: string;
  readonly server: RscServerDefinition<Context>;
  readonly serverFunctions: ReadonlyMap<string, unknown>;
  readonly unit: string;
}

export type RscHandler = (request: Request) => Promise<Response>;

interface RscDispatchInput {
  readonly context: Readonly<Record<string, unknown>>;
  readonly data: unknown;
  readonly props: unknown;
  readonly signal: AbortSignal;
}

interface RscDispatchEntry {
  readonly execute: (input: RscDispatchInput) => Promise<unknown>;
  readonly middleware: readonly PreparedRscServerMiddleware[];
}

export function createRscErrorDigest(): string {
  return `rsc_${globalThis.crypto.randomUUID()}`;
}

export function createRscHandler<Context extends object>(
  options: CreateRscHandlerOptions<Context>,
  dependencies: RscHandlerDependencies
): RscHandler {
  const server = getRscServerImplementation(options.server);
  const globalMiddleware = prepareRscServerMiddleware(server.middleware);
  const dispatchCatalog = createDispatchCatalog(
    options.roots,
    options.serverFunctions
  );
  const clientReferences = new Map(
    options.platformManifests.map((manifest) => [
      manifest.platform,
      createFlightClientManifest(manifest.clientReferences),
    ])
  );

  return async (request) => {
    let applicationStarted = false;
    try {
      const parsedRequest = await parseRscProtocolRequest(request, {
        decodeReply: dependencies.decodeReply,
        platforms: [...clientReferences.keys()],
        runtimeVersion: options.runtimeVersion,
        unit: options.unit,
      });
      const { frame } = parsedRequest;
      const dispatchEntry = dispatchCatalog[parsedRequest.kind].get(frame.id);
      if (!dispatchEntry) {
        throw new RscRequestError({
          code: 'RSC_NOT_FOUND',
          message: `RSC ${parsedRequest.kind} target "${frame.id}" was not found.`,
          status: 404,
        });
      }

      applicationStarted = true;
      const context = await server.createContext({
        request,
        signal: request.signal,
      });
      const model = await runPreparedServerMiddleware(
        [...globalMiddleware, ...dispatchEntry.middleware],
        {
          context: context as Readonly<Record<string, unknown>>,
          request,
          signal: request.signal,
        },
        (context) =>
          dispatchEntry.execute({
            context,
            data: frame.data,
            props: frame.props,
            signal: request.signal,
          })
      );
      const stream = dependencies.render(
        model,
        clientReferences.get(parsedRequest.platform)!,
        {
          onError(error) {
            const digest = dependencies.createDigest(error);
            void handleRscServerImplementationError(server, error, {
              development: options.development,
              digest,
              request,
            });
            return digest;
          },
          signal: request.signal,
        }
      );
      return new Response(stream, {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/x-component',
        },
      });
    } catch (error) {
      const expectedPreApplicationFailure =
        !applicationStarted &&
        (isRscCompatibilityError(error) || isRscRequestError(error));
      const problem = expectedPreApplicationFailure
        ? toRscProblemDetails(error, { development: true })
        : await handleRscServerImplementationError(server, error, {
            development: options.development,
            digest: dependencies.createDigest(error),
            request,
          });
      return createProblemResponse(problem);
    }
  };
}

function createDispatchCatalog(
  roots: ReadonlyMap<string, unknown>,
  serverFunctions: ReadonlyMap<string, unknown>
): Readonly<{
  action: ReadonlyMap<string, RscDispatchEntry>;
  render: ReadonlyMap<string, RscDispatchEntry>;
}> {
  const render = new Map<string, RscDispatchEntry>();
  for (const [id, root] of roots) {
    const executeRoot = prepareRscRoot(root);
    render.set(
      id,
      Object.freeze({
        execute: ({ context, props }: RscDispatchInput) =>
          executeRoot({ context, props }),
        middleware: Object.freeze([]),
      })
    );
  }

  const action = new Map<string, RscDispatchEntry>();
  for (const [id, serverFunction] of serverFunctions) {
    const prepared = prepareServerFn(serverFunction);
    action.set(
      id,
      Object.freeze({
        execute: ({ context, data, signal }: RscDispatchInput) =>
          prepared.execute({ context, data, signal }),
        middleware: prepared.middleware,
      })
    );
  }

  return Object.freeze({ action, render });
}

function createFlightClientManifest(
  contracts: readonly RscClientReferenceContract[]
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(
      contracts.map((contract) => [
        contract.id,
        Object.freeze({
          async: contract.target.async,
          chunks: contract.target.chunks.flatMap((chunk) => [
            chunk.id,
            chunk.file,
          ]),
          id: contract.target.moduleId,
          name: contract.target.exportName,
        }),
      ])
    )
  );
}

function createProblemResponse(problem: RscProblemDetails): Response {
  return Response.json(problem, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/problem+json',
    },
    status: problem.status,
  });
}
