import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Compiler } from '@rspack/core';
import { registerRscDevServerRoute } from '../devServerRoutes.js';

type Middleware = {
  readonly name?: string;
  readonly path?: string;
  readonly middleware: (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void
  ) => void;
};

function createCompiler(
  context: string,
  platform: 'android' | 'ios',
  setupMiddlewares?: (
    middlewares: Middleware[],
    server: unknown
  ) => Middleware[]
): Compiler {
  return {
    context,
    options: {
      devServer: {
        host: 'localhost',
        port: 8081,
        setupMiddlewares,
      },
      name: platform,
    },
  } as unknown as Compiler;
}

describe('registerRscDevServerRoute', () => {
  it('collects routes from every platform without a Re.Pack core registry', () => {
    const context = `/project-${expect.getState().currentTestName}`;
    const ios = createCompiler(context, 'ios');
    const android = createCompiler(context, 'android');

    registerRscDevServerRoute(ios, {
      handler: jest.fn(),
      path: '/.repack/rsc/widget/ios',
    });
    registerRscDevServerRoute(android, {
      handler: jest.fn(),
      path: '/.repack/rsc/widget/android',
    });

    const setup = ios.options.devServer?.setupMiddlewares;
    expect(setup).toBeDefined();
    const result = setup?.([], {} as never) as Middleware[];

    expect(result.map(({ name, path }) => ({ name, path }))).toEqual([
      {
        name: 'repack-rsc:/.repack/rsc/widget/ios',
        path: '/.repack/rsc/widget/ios',
      },
      {
        name: 'repack-rsc:/.repack/rsc/widget/android',
        path: '/.repack/rsc/widget/android',
      },
    ]);
  });

  it('preserves application middleware while keeping the RSC route terminal', () => {
    const userMiddleware: Middleware = {
      middleware: jest.fn(),
      name: 'user-auth',
    };
    const setupMiddlewares = jest.fn((middlewares: Middleware[]) => [
      userMiddleware,
      ...middlewares,
    ]);
    const compiler = createCompiler(
      `/project-${expect.getState().currentTestName}`,
      'ios',
      setupMiddlewares
    );

    registerRscDevServerRoute(compiler, {
      handler: jest.fn(),
      path: '/.repack/rsc/widget/ios',
    });

    const builtIn: Middleware = {
      middleware: jest.fn(),
      name: 'dev-middleware',
    };
    const result = compiler.options.devServer?.setupMiddlewares?.(
      [builtIn],
      {} as never
    ) as Middleware[];

    expect(setupMiddlewares).toHaveBeenCalledTimes(1);
    expect(result.map(({ name }) => name)).toEqual([
      'repack-rsc:/.repack/rsc/widget/ios',
      'user-auth',
      'dev-middleware',
    ]);
  });

  it('restores the full request URL before invoking the RSC handler', () => {
    const compiler = createCompiler(
      `/project-${expect.getState().currentTestName}`,
      'ios'
    );
    const handler = jest.fn();
    registerRscDevServerRoute(compiler, {
      handler,
      path: '/.repack/rsc/widget/ios',
    });
    const [route] = compiler.options.devServer?.setupMiddlewares?.(
      [],
      {} as never
    ) as Middleware[];
    const request = {
      originalUrl: '/.repack/rsc/widget/ios?action=checkMe',
      url: '/?action=checkMe',
    } as unknown as IncomingMessage;
    const response = {} as ServerResponse;

    route?.middleware(request, response, jest.fn());

    expect(request.url).toBe('/.repack/rsc/widget/ios?action=checkMe');
    expect(handler).toHaveBeenCalledWith(request, response);
  });

  it('rejects duplicate routes on one compiler', () => {
    const compiler = createCompiler(
      `/project-${expect.getState().currentTestName}`,
      'ios'
    );
    const route = {
      handler: jest.fn(),
      path: '/.repack/rsc/widget/ios',
    };

    registerRscDevServerRoute(compiler, route);

    expect(() => registerRscDevServerRoute(compiler, route)).toThrow(
      'already registered'
    );
  });

  it('does not leak routes into a later compiler lifecycle', () => {
    const context = `/project-${expect.getState().currentTestName}`;
    const first = createCompiler(context, 'ios');
    const dispose = registerRscDevServerRoute(first, {
      handler: jest.fn(),
      path: '/.repack/rsc/old/ios',
    });

    dispose();

    const second = createCompiler(context, 'ios');
    registerRscDevServerRoute(second, {
      handler: jest.fn(),
      path: '/.repack/rsc/new/ios',
    });
    const result = second.options.devServer?.setupMiddlewares?.(
      [],
      {} as never
    ) as Middleware[];

    expect(result.map(({ path }) => path)).toEqual(['/.repack/rsc/new/ios']);
  });

  it('keeps a middleware snapshot alive while isolating a later session', () => {
    const context = `/project-${expect.getState().currentTestName}`;
    const oldHandler = jest.fn();
    const first = createCompiler(context, 'ios');
    const dispose = registerRscDevServerRoute(first, {
      handler: oldHandler,
      path: '/.repack/rsc/old/ios',
    });
    const firstSetup = first.options.devServer?.setupMiddlewares;
    const firstSnapshot = firstSetup?.([], {} as never) as Middleware[];

    const second = createCompiler(context, 'ios');
    registerRscDevServerRoute(second, {
      handler: jest.fn(),
      path: '/.repack/rsc/new/ios',
    });

    expect(firstSetup?.([], {} as never)).toEqual([
      expect.objectContaining({ path: '/.repack/rsc/old/ios' }),
    ]);
    expect(
      second.options.devServer?.setupMiddlewares?.([], {} as never)
    ).toEqual([expect.objectContaining({ path: '/.repack/rsc/new/ios' })]);

    dispose();
    dispose();
    firstSnapshot[0]?.middleware(
      { url: '/.repack/rsc/old/ios' } as IncomingMessage,
      {} as ServerResponse,
      jest.fn()
    );
    expect(oldHandler).toHaveBeenCalledTimes(1);
  });
});
