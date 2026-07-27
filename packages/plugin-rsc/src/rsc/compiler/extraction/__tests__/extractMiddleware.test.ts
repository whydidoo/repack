import { RscExtractionError, extractRscDeclarations } from '../index.js';

function captureExtractionError(callback: () => void): RscExtractionError {
  try {
    callback();
  } catch (error) {
    if (error instanceof RscExtractionError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected RscExtractionError to be thrown');
}

describe('extractRscDeclarations middleware', () => {
  it('keeps only the client callback and its reachable imports in the client graph', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createToken } from './client-only';",
      "import { verifyToken } from './server-only';",
      '',
      'const checkMeMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      '    return next({ headers: { authorization: await createToken() } });',
      '  })',
      '  .server(async ({ next, request }) => {',
      "    await verifyToken(request.headers.get('authorization'));",
      '    return next();',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/checkMe.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/checkMe.server.ts',
      unit: 'account',
    });

    expect(result.middleware).toEqual([
      {
        client: true,
        localName: 'checkMeMiddleware',
        server: true,
      },
    ]);
    expect(result.code).toContain('.client(async ({ next }) => {');
    expect(result.code).toContain(
      'createMiddleware as __repack_createMiddleware'
    );
    expect(result.code).toContain("from './client-only'");
    expect(result.code).not.toContain(
      "from '@callstack/repack-plugin-rsc/server'"
    );
    expect(result.code).not.toContain('.server(');
    expect(result.code).not.toContain('verifyToken');
    expect(result.code).not.toContain("from './server-only'");
  });

  it('keeps only the server callback and its reachable imports in the server graph', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createToken } from './client-only';",
      "import { verifyToken } from './server-only';",
      '',
      'const checkMeMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      '    return next({ headers: { authorization: await createToken() } });',
      '  })',
      '  .server(async ({ next, request }) => {',
      "    await verifyToken(request.headers.get('authorization'));",
      '    return next();',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/checkMe.server.ts',
      graph: 'server',
      source,
      sourcePath: 'functions/checkMe.server.ts',
      unit: 'account',
    });

    expect(result.code).toContain('.server(async ({ next, request }) => {');
    expect(result.code).toContain("from './server-only'");
    expect(result.code).not.toContain('.client(');
    expect(result.code).not.toContain('createToken');
    expect(result.code).not.toContain("from './client-only'");
  });

  it('removes top-level helpers reachable only from the other graph', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createVerifier } from './server-only';",
      '',
      'const verifier = createVerifier();',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => next())',
      '  .server(async ({ next, request }) => {',
      '    await verifier.verify(request);',
      '    return next();',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/auth.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/auth.server.ts',
      unit: 'account',
    });

    expect(result.code).not.toContain('const verifier');
    expect(result.code).not.toContain('createVerifier');
    expect(result.code).not.toContain("from './server-only'");
  });

  it('prunes an opposite-graph declarator without removing its unrelated siblings', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createVerifier } from './server-only';",
      "import { registerTelemetry } from './telemetry';",
      '',
      'const serverHelper = createVerifier(), unrelated = 1, telemetryRegistration = registerTelemetry();',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => next())',
      '  .server(async ({ next }) => {',
      '    serverHelper.verify();',
      '    return next();',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/auth.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/auth.server.ts',
      unit: 'account',
    });

    expect(result.code).toContain(
      'const unrelated = 1, telemetryRegistration = registerTelemetry();'
    );
    expect(result.code).toContain("from './telemetry'");
    expect(result.code).not.toContain('serverHelper');
    expect(result.code).not.toContain('createVerifier');
    expect(result.code).not.toContain("from './server-only'");
  });

  it('prunes transformed helper chains transitively', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { verifyToken } from './server-only';",
      '',
      'class Verifier {',
      '  verify(request: Request) { return verifyToken(request); }',
      '}',
      'function verify(request: Request) {',
      '  return new Verifier().verify(request);',
      '}',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => next())',
      '  .server(async ({ next, request }) => {',
      '    await verify(request);',
      '    return next();',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/auth.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/auth.server.ts',
      unit: 'account',
    });

    expect(result.code).not.toContain('function verify');
    expect(result.code).not.toContain('class Verifier');
    expect(result.code).not.toContain('verifyToken');
    expect(result.code).not.toContain("from './server-only'");
  });

  it('preserves unrelated effectful top-level initializers while pruning the removed graph', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { registerTelemetry } from './telemetry';",
      "import { verifyToken } from './server-only';",
      '',
      'const telemetryRegistration = registerTelemetry();',
      'function verify(request: Request) {',
      '  return verifyToken(request);',
      '}',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => next())',
      '  .server(async ({ next, request }) => {',
      '    await verify(request);',
      '    return next();',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/auth.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/auth.server.ts',
      unit: 'account',
    });

    expect(result.code).toContain(
      'const telemetryRegistration = registerTelemetry();'
    );
    expect(result.code).toContain("from './telemetry'");
    expect(result.code).not.toContain('function verify');
    expect(result.code).not.toContain('verifyToken');
    expect(result.code).not.toContain("from './server-only'");
  });

  it('rejects a non-serializable capture shared by both graph halves', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createSession } from './session';",
      '',
      'const session = createSession();',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      '    return next({ headers: { authorization: session.token } });',
      '  })',
      '  .server(async ({ next, request }) => {',
      '    await session.verify(request);',
      '    return next();',
      '  });',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/auth.server.ts',
        graph: 'client',
        source,
        sourcePath: 'functions/auth.server.ts',
        unit: 'account',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE',
      filename: '/project/src/functions/auth.server.ts',
      location: { column: 6, line: 5 },
      message:
        'RSC middleware "authMiddleware" captures "session" in both graph halves.\n' +
        'Only statically serializable top-level const values may be shared between .client() and .server().',
    });
  });

  it('does not let a nested shadowing binding hide a top-level shared capture', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createSession } from './session';",
      '',
      'const session = createSession();',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      '    const ignore = (session) => session;',
      '    ignore(1);',
      '    return next({ headers: { authorization: session.token } });',
      '  })',
      '  .server(async ({ next }) => {',
      '    session.verify();',
      '    return next();',
      '  });',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/auth.server.ts',
        graph: 'client',
        source,
        sourcePath: 'functions/auth.server.ts',
        unit: 'account',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE',
      message:
        'RSC middleware "authMiddleware" captures "session" in both graph halves.\n' +
        'Only statically serializable top-level const values may be shared between .client() and .server().',
    });
  });

  it('rejects a top-level function captured by both graph halves', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      '',
      "function sharedHelper() { return 'authorization'; }",
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      "    return next({ headers: { [sharedHelper()]: 'token' } });",
      '  })',
      '  .server(async ({ next, request }) => {',
      '    request.headers.get(sharedHelper());',
      '    return next();',
      '  });',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/auth.server.ts',
        graph: 'client',
        source,
        sourcePath: 'functions/auth.server.ts',
        unit: 'account',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE',
      filename: '/project/src/functions/auth.server.ts',
      location: { column: 6, line: 4 },
      message:
        'RSC middleware "authMiddleware" captures "sharedHelper" in both graph halves.\n' +
        'Only statically serializable top-level const values may be shared between .client() and .server().',
    });
  });

  it('does not treat a helper parameter as a capture of a shadowed top-level binding', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createSession } from './session';",
      '',
      'const session = createSession();',
      'function authorize(session) { return session; }',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      "    return next({ headers: { authorization: authorize('safe') } });",
      '  })',
      '  .server(async ({ next }) => {',
      '    session.verify();',
      '    return next();',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/auth.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/auth.server.ts',
      unit: 'account',
    });

    expect(result.code).toContain(
      'function authorize(session) { return session; }'
    );
    expect(result.code).not.toContain('createSession');
    expect(result.code).not.toContain("from './session'");
  });

  it('rejects an opaque capture shared indirectly through distinct helper chains', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "import { createSession } from './session';",
      '',
      'const session = createSession();',
      'function getAuthorization() {',
      '  return readSessionToken();',
      '}',
      'function readSessionToken() {',
      '  return session.token;',
      '}',
      'function verifyRequest(request: Request) {',
      '  return verifySession(request);',
      '}',
      'function verifySession(request: Request) {',
      '  return session.verify(request);',
      '}',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      '    return next({ headers: { authorization: getAuthorization() } });',
      '  })',
      '  .server(async ({ next, request }) => {',
      '    await verifyRequest(request);',
      '    return next();',
      '  });',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/auth.server.ts',
        graph: 'client',
        source,
        sourcePath: 'functions/auth.server.ts',
        unit: 'account',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE',
      message:
        'RSC middleware "authMiddleware" captures "session" in both graph halves.\n' +
        'Only statically serializable top-level const values may be shared between .client() and .server().',
    });
  });

  it('preserves a statically serializable declaration shared by both halves', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "const headerName = 'authorization';",
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      "    return next({ headers: { [headerName]: 'token' } });",
      '  })',
      '  .server(async ({ next, request }) => {',
      '    request.headers.get(headerName);',
      '    return next();',
      '  });',
    ].join('\n');
    const extract = (graph: 'client' | 'server') =>
      extractRscDeclarations({
        filename: '/project/src/functions/auth.server.ts',
        graph,
        source,
        sourcePath: 'functions/auth.server.ts',
        unit: 'account',
      });

    expect(extract('client').code).toContain(
      "const headerName = 'authorization';"
    );
    expect(extract('server').code).toContain(
      "const headerName = 'authorization';"
    );
  });

  it('rejects a mutable serializable capture shared by both graph halves', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      "let headerName = 'authorization';",
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => {',
      "    return next({ headers: { [headerName]: 'token' } });",
      '  })',
      '  .server(async ({ next, request }) => {',
      '    request.headers.get(headerName);',
      '    return next();',
      '  });',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/auth.server.ts',
        graph: 'client',
        source,
        sourcePath: 'functions/auth.server.ts',
        unit: 'account',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE',
      message:
        'RSC middleware "authMiddleware" captures "headerName" in both graph halves.\n' +
        'Only statically serializable top-level const values may be shared between .client() and .server().',
    });
  });

  it('rejects an opaque destructured capture shared by both graph halves', () => {
    const source = [
      "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
      'const { shared } = makeHelpers();',
      'const authMiddleware = createMiddleware()',
      '  .client(async ({ next }) => next({ headers: shared.headers }))',
      '  .server(async ({ next }) => {',
      '    shared.verify();',
      '    return next();',
      '  });',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/auth.server.ts',
        graph: 'client',
        source,
        sourcePath: 'functions/auth.server.ts',
        unit: 'account',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE',
      message:
        'RSC middleware "authMiddleware" captures "shared" in both graph halves.\n' +
        'Only statically serializable top-level const values may be shared between .client() and .server().',
    });
  });

  it('connects ordered client middleware to its Server Function proxy', () => {
    const source = [
      'import {',
      '  createMiddleware,',
      '  createServerFn,',
      "} from '@callstack/repack-plugin-rsc/server';",
      'const auth = createMiddleware().client(async ({ next }) => next());',
      'const audit = createMiddleware().client(async ({ next }) => next());',
      'export const checkMe = createServerFn()',
      '  .middleware([auth, audit])',
      '  .handler(async () => true);',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/checkMe.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/checkMe.server.ts',
      unit: 'account',
    });

    expect(result.serverFunctions[0]?.middleware).toEqual(['auth', 'audit']);
    expect(result.code).toContain(
      '__repack_createServerFnProxy({' +
        '"exportName":"checkMe","sourcePath":"functions/checkMe.server.ts"' +
        '}, [auth, audit])'
    );
  });

  it('omits server-only middleware from the generated client caller', () => {
    const source = [
      'import {',
      '  createMiddleware,',
      '  createServerFn,',
      "} from '@callstack/repack-plugin-rsc/server';",
      'const serverAuth = createMiddleware().server(async ({ next }) => next());',
      'export const checkMe = createServerFn()',
      '  .middleware([serverAuth])',
      '  .handler(async () => true);',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/checkMe.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/checkMe.server.ts',
      unit: 'account',
    });

    expect(result.serverFunctions[0]?.middleware).toEqual(['serverAuth']);
    expect(result.code).toContain(
      '__repack_createServerFnProxy({' +
        '"exportName":"checkMe","sourcePath":"functions/checkMe.server.ts"' +
        '})'
    );
    expect(result.code).not.toContain('[serverAuth]');
    expect(result.code).not.toContain('.server(');
  });

  it('rejects a dynamic Server Function middleware list', () => {
    const source = [
      "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
      'export const checkMe = createServerFn()',
      '  .middleware(getMiddleware())',
      '  .handler(async () => true);',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/checkMe.server.ts',
        graph: 'client',
        source,
        sourcePath: 'functions/checkMe.server.ts',
        unit: 'account',
      })
    );

    expect(error.code).toBe('RSC_MIDDLEWARE_STATIC_LIST_REQUIRED');
  });
});
