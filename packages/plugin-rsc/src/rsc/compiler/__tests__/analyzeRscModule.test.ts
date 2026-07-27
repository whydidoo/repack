import { analyzeRscModule } from '../parseRscModule.js';

describe('analyzeRscModule', () => {
  it('collects parser-independent facts for all compiler source consumers', () => {
    const source = [
      "import { createMiddleware, createServerFn, defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      'const auth = createMiddleware().client(() => null).server(() => null);',
      "export const Root = defineRscRoot({ props: schema, reloadOn: ['id'] });",
      'export const action = createServerFn().middleware([auth]).inputValidator(schema).handler(() => null);',
      "export { Legacy as Renamed } from './legacy';",
      "export * from './barrel';",
    ].join('\n');

    const analysis = analyzeRscModule(source, '/project/src/module.rsc.tsx');

    expect(analysis).not.toHaveProperty('program');
    expect(analysis.discovery.declarations).toEqual([
      {
        kind: 'middleware',
        localName: 'auth',
        location: { column: 6, line: 2 },
      },
      {
        exportName: 'Root',
        kind: 'root',
        location: { column: 13, line: 3 },
      },
      {
        exportName: 'action',
        kind: 'server-function',
        location: { column: 13, line: 4 },
      },
    ]);
    expect(analysis.declarationSyntax).toMatchObject([
      {
        clientCall: expect.any(Object),
        kind: 'middleware',
        name: 'auth',
        serverCall: expect.any(Object),
      },
      {
        kind: 'root',
        name: 'Root',
        options: {
          options: { pending: 'retain', reloadOn: ['id'] },
          valid: true,
        },
        propsSchema: true,
      },
      {
        hasHandler: true,
        hasInputValidator: true,
        kind: 'server-function',
        middlewareBindings: ['auth'],
        name: 'action',
      },
    ]);
    expect(analysis.namedReExports).toEqual([
      {
        exportName: 'Renamed',
        importedName: 'Legacy',
        location: { column: 9, line: 5 },
        specifier: './legacy',
      },
    ]);
    expect(analysis.exportAll).toEqual([
      {
        location: { column: 0, line: 6 },
        specifier: './barrel',
      },
    ]);
    expect(analysis.pruning).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ names: ['auth'] }),
      ]),
      imports: expect.arrayContaining([
        expect.objectContaining({
          bindings: ['createMiddleware', 'createServerFn', 'defineRscRoot'],
        }),
      ]),
    });
  });
});
