import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LoaderContext } from '@rspack/core';
import { RSC_SERVER_LAYER } from '../constants.js';
import rscLoader, { type RscLoaderOptions } from '../rscLoader.js';

interface TestSourceMap {
  readonly file: string;
  readonly mappings: string;
  readonly names: string[];
  readonly sources: string[];
  readonly version: 3;
}

describe('rscLoader', () => {
  const filename = '/project/src/Root.tsx';
  const source = [
    "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
    "import { database } from './database.server';",
    'export const Root = defineRscRoot(async () => database.render());',
  ].join('\n');

  it('extracts the same source according to its Rspack graph layer', () => {
    const inputSourceMap = {
      file: filename,
      mappings: 'AAAA;AACA;AACA',
      names: [],
      sources: [filename],
      version: 3 as const,
    };
    const client = runLoader(source, undefined, inputSourceMap);
    const server = runLoader(source, RSC_SERVER_LAYER);

    expect(client.error).toBeNull();
    expect(client.code).toContain("from 'repack:rsc/widget/client-runtime';");
    expect(client.code).not.toContain('database.render');
    expect(client.code?.split('\n')[2]).toContain('export const Root');
    expect(client.sourceMap).toBe(inputSourceMap);
    expect(server.error).toBeNull();
    expect(server.code).toBe(source);
  });

  it('emits a source-located Rspack diagnostic for compiler errors', () => {
    const invalidSource = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'const Root = defineRscRoot(() => null);',
    ].join('\n');
    const result = runLoader(invalidSource, undefined);

    expect(result.error).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        file: filename,
        location: {
          column: 6,
          length: 1,
          line: 3,
        },
        severity: 'error',
        sourceCode: invalidSource,
      }),
    ]);
  });

  it('brands only this module client references in the server layer', () => {
    const result = runLoader(
      "'use client';\nexport const Button = () => null;",
      RSC_SERVER_LAYER,
      undefined,
      {
        clientReferences: [
          {
            exportName: 'Ignored',
            filename: '/project/src/Other.tsx',
            id: 'rsc_ignored',
            targetExportName: 'Ignored',
          },
          {
            exportName: 'Button',
            filename,
            id: 'rsc_button',
            targetExportName: 'Button',
          },
        ],
      }
    );

    expect(result.error).toBeNull();
    expect(result.code).toContain('}, "rsc_button", "Button");');
    expect(result.code).not.toContain('rsc_ignored');
  });

  it('matches client-reference claims through a physical resource filename', () => {
    const projectRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-loader-'))
    );
    try {
      const physicalRoot = path.join(projectRoot, 'physical');
      const linkedRoot = path.join(projectRoot, 'linked');
      const physicalFilename = path.join(physicalRoot, 'Button.tsx');
      fs.mkdirSync(physicalRoot, { recursive: true });
      fs.writeFileSync(
        physicalFilename,
        "'use client';\nexport const Button = 1;"
      );
      fs.symlinkSync(physicalRoot, linkedRoot, 'dir');

      const result = runLoader(
        "'use client';\nexport const Button = 1;",
        RSC_SERVER_LAYER,
        undefined,
        {
          clientReferences: [
            {
              exportName: 'Button',
              filename: physicalFilename,
              id: 'rsc_button',
              targetExportName: 'Button',
            },
          ],
          roots: [linkedRoot],
        },
        path.join(linkedRoot, 'Button.tsx')
      );

      expect(result.error).toBeNull();
      expect(result.code).toContain('}, "rsc_button", "Button");');
    } finally {
      fs.rmSync(projectRoot, { force: true, recursive: true });
    }
  });
});

function runLoader(
  source: string,
  layer: string | undefined,
  inputSourceMap?: TestSourceMap,
  loaderOptions: Partial<RscLoaderOptions> = {},
  resourcePath = '/project/src/Root.tsx'
) {
  let code: string | undefined;
  let error: Error | null | undefined;
  let sourceMap: TestSourceMap | string | undefined;
  const diagnostics: Array<Record<string, unknown>> = [];
  const context = {
    _module: { layer },
    async:
      () =>
      (
        callbackError?: Error | null,
        callbackCode?: string | Buffer,
        callbackSourceMap?: TestSourceMap | string
      ) => {
        error = callbackError;
        code = callbackCode?.toString();
        sourceMap = callbackSourceMap;
      },
    cacheable: () => undefined,
    experiments: {
      emitDiagnostic: (diagnostic: Record<string, unknown>) => {
        diagnostics.push(diagnostic);
      },
    },
    getOptions: (): RscLoaderOptions => ({
      roots: ['/project/src'],
      unit: 'widget',
      ...loaderOptions,
    }),
    resourcePath,
  } as unknown as LoaderContext<RscLoaderOptions>;

  rscLoader.call(context, source, inputSourceMap);

  return { code, diagnostics, error, sourceMap };
}
