import type { Compilation } from '@rspack/core';
import { planRscCompilation } from '../../compiler/plan/index.js';
import { createRspackClientReferenceContracts } from '../rspackClientReferenceContracts.js';

describe('createRspackClientReferenceContracts', () => {
  it('projects observable compiled target facts onto planned logical identities', () => {
    const targetFilename = '/project/src/Button.js';
    const plan = planRscCompilation({
      config: {
        name: 'widget',
        runtime: '/project/src/rsc.runtime.js',
        runtimeVersion: '7',
        server: {
          roots: ['/project/src'],
          setup: '/project/src/rsc.server.js',
        },
      },
      contractIndex: {
        clientEntries: [targetFilename],
        contracts: [
          {
            claim: {
              filename: '/project/src/LegacyButton.js',
              location: { column: 9, line: 1 },
            },
            identity: {
              exportName: 'LegacyButton',
              sourcePath: 'LegacyButton.js',
            },
            kind: 'client-reference',
            target: {
              exportName: 'Button',
              filename: targetFilename,
              sourcePath: 'Button.js',
            },
          },
        ],
      },
      target: { kind: 'development', platform: 'ios' },
    });
    const module = { resource: targetFilename };
    const compilation = {
      chunkGraph: {
        getModuleChunksIterable: () => [
          { files: new Set(['z.js', 'a.js']), id: 7 },
        ],
        getModuleId: () => 42,
      },
      moduleGraph: { isAsync: () => true },
      modules: [module],
    } as unknown as Compilation;

    expect(createRspackClientReferenceContracts({ compilation, plan })).toEqual(
      [
        {
          id: plan.clientReferenceClaims[0]?.id,
          identity: {
            exportName: 'LegacyButton',
            sourcePath: 'LegacyButton.js',
          },
          target: {
            async: true,
            chunks: [
              { file: './a.js', id: 7 },
              { file: './z.js', id: 7 },
            ],
            exportName: 'Button',
            moduleId: 42,
          },
        },
      ]
    );
  });
});
