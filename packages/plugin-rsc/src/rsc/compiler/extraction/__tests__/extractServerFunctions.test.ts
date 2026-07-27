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

describe('extractRscDeclarations Server Functions', () => {
  it('replaces a server handler with a typed client caller proxy', () => {
    const source = [
      "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
      "import { database } from './server-only';",
      '',
      'export const checkMe = createServerFn()',
      '  .inputValidator(CheckMeSchema)',
      '  .handler(async ({ data, context, signal }) => {',
      '    return database.check(data, context.user, { signal });',
      '  });',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/checkMe.server.ts',
      graph: 'client',
      source,
      sourcePath: 'functions/checkMe.server.ts',
      unit: 'account',
    });

    expect(result.serverFunctions).toEqual([
      {
        identity: {
          exportName: 'checkMe',
          sourcePath: 'functions/checkMe.server.ts',
        },
        input: { kind: 'standard-schema' },
        middleware: [],
      },
    ]);
    expect(result.code).toContain("from 'repack:rsc/account/client-runtime';");
    expect(result.code).toContain(
      'export const checkMe = __repack_createServerFnProxy({' +
        '"exportName":"checkMe","sourcePath":"functions/checkMe.server.ts"' +
        '});'
    );
    expect(result.code).not.toContain('.handler(');
    expect(result.code).not.toContain('return database.check');
    expect(result.code).not.toContain("from './server-only'");
  });

  it('rejects a declaration without a terminal handler', () => {
    const source = [
      "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
      'export const checkMe = createServerFn().inputValidator(CheckMeSchema);',
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

    expect(error).toMatchObject({
      code: 'RSC_SERVER_FN_HANDLER_REQUIRED',
      filename: '/project/src/functions/checkMe.server.ts',
      location: { column: 13, line: 2 },
      message:
        'Server Function "checkMe" has no handler.\n' +
        'Finish the declaration with .handler(async ({ data, context, signal }) => ...).',
    });
  });

  it('rejects a handler that is not the terminal builder call', () => {
    const source = [
      "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
      'export const checkMe = createServerFn()',
      '  .handler(async () => null)',
      '  .inputValidator(CheckMeSchema);',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/functions/checkMe.server.js',
        graph: 'client',
        source,
        sourcePath: 'functions/checkMe.server.js',
        unit: 'account',
      })
    );

    expect(error.code).toBe('RSC_SERVER_FN_HANDLER_REQUIRED');
  });

  it('keeps the handler and excludes caller proxy code in the server graph', () => {
    const source = [
      "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
      'export const ping = createServerFn().handler(async ({ data }) => {',
      '  return { pong: data };',
      '});',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/functions/ping.server.ts',
      graph: 'server',
      source,
      sourcePath: 'functions/ping.server.ts',
      unit: 'account',
    });

    expect(result.code).toBe(source);
    expect(result.code).toContain('return { pong: data }');
    expect(result.code).not.toContain('__repack_createServerFnProxy');
    expect(result.serverFunctions).toEqual([
      {
        identity: {
          exportName: 'ping',
          sourcePath: 'functions/ping.server.ts',
        },
        input: { kind: 'none' },
        middleware: [],
      },
    ]);
  });
});
