import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Compiler } from '@rspack/core';
import { RscConfigurationError } from '../../configurationError.js';

type Next = (error?: unknown) => void;

interface Middleware {
  readonly name?: string;
  readonly path?: string;
  readonly middleware: (
    request: IncomingMessage,
    response: ServerResponse,
    next: Next
  ) => void;
}

type SetupMiddlewares = (
  middlewares: Middleware[],
  devServer: unknown
) => Middleware[];

export interface RscDevServerRoute {
  readonly path: string;
  readonly handler: (
    request: IncomingMessage,
    response: ServerResponse
  ) => void;
}

interface RegisteredRoute extends RscDevServerRoute {
  readonly owner: Compiler;
}

interface RouteGroup {
  readonly routes: Map<string, RegisteredRoute>;
  readonly serverKey: string;
}

interface DevServerOptions {
  readonly host?: string;
  readonly port?: number;
  setupMiddlewares?: SetupMiddlewares;
}

const RSC_SETUP_MIDDLEWARE = Symbol('repack.rsc.dev-server-middleware');
const routesByServer = new Map<string, RouteGroup>();
const routesByCompiler = new WeakMap<object, Set<string>>();

type RscSetupMiddlewares = SetupMiddlewares & {
  readonly [RSC_SETUP_MIDDLEWARE]?: RouteGroup;
};

function createServerKey(
  compiler: Compiler,
  options: DevServerOptions
): string {
  return JSON.stringify([
    compiler.context,
    options.host ?? '',
    options.port ?? '',
  ]);
}

function createMiddleware(route: RscDevServerRoute): Middleware {
  return Object.freeze({
    name: `repack-rsc:${route.path}`,
    path: route.path,
    middleware(request: IncomingMessage, response: ServerResponse) {
      request.url =
        (request as IncomingMessage & { originalUrl?: string }).originalUrl ??
        request.url;
      route.handler(request, response);
    },
  });
}

function createRouteDisposer(
  compiler: Compiler,
  group: RouteGroup,
  path: string
): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    const compilerRoutes = routesByCompiler.get(compiler);
    compilerRoutes?.delete(path);
    if (compilerRoutes?.size === 0) {
      routesByCompiler.delete(compiler);
    }
    if (group.routes.get(path)?.owner === compiler) {
      group.routes.delete(path);
    }
    if (
      group.routes.size === 0 &&
      routesByServer.get(group.serverKey) === group
    ) {
      routesByServer.delete(group.serverKey);
    }
  };
}

/** Register an RSC development route through Rspack's existing devServer seam. */
export function registerRscDevServerRoute(
  compiler: Compiler,
  route: RscDevServerRoute
): () => void {
  const options = compiler.options.devServer as DevServerOptions | undefined;
  if (!options) {
    throw new RscConfigurationError(
      'RSC development routes require Rspack devServer options.'
    );
  }

  let compilerRoutes = routesByCompiler.get(compiler);
  if (compilerRoutes?.has(route.path)) {
    throw new RscConfigurationError(
      `RSC development route "${route.path}" is already registered for compiler "${compiler.options.name ?? '<unnamed>'}".`
    );
  }
  const serverKey = createServerKey(compiler, options);
  let group = routesByServer.get(serverKey);
  if (!group) {
    group = { routes: new Map(), serverKey };
    routesByServer.set(serverKey, group);
  }
  if (group.routes.has(route.path)) {
    throw new RscConfigurationError(
      `RSC development route "${route.path}" is already registered for dev server ${serverKey}.`
    );
  }
  if (!compilerRoutes) {
    compilerRoutes = new Set();
    routesByCompiler.set(compiler, compilerRoutes);
  }
  compilerRoutes.add(route.path);
  group.routes.set(route.path, Object.freeze({ ...route, owner: compiler }));
  const dispose = createRouteDisposer(compiler, group, route.path);

  const currentSetup = options.setupMiddlewares as
    | RscSetupMiddlewares
    | undefined;
  if (currentSetup?.[RSC_SETUP_MIDDLEWARE] === group) {
    return dispose;
  }

  const setupMiddlewares: RscSetupMiddlewares = (middlewares, devServer) => {
    if (routesByServer.get(serverKey) === group) {
      routesByServer.delete(serverKey);
    }
    const configuredMiddlewares = currentSetup
      ? currentSetup(middlewares, devServer)
      : middlewares;
    return [
      ...[...group.routes.values()].map(createMiddleware),
      ...configuredMiddlewares,
    ];
  };
  Object.defineProperty(setupMiddlewares, RSC_SETUP_MIDDLEWARE, {
    value: group,
  });
  options.setupMiddlewares = setupMiddlewares;
  return dispose;
}
