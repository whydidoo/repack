import {
  RscContractIndexError,
  createRscClientReferenceContracts,
  indexRscContracts,
} from '../index.js';

function captureIndexError(callback: () => void): RscContractIndexError {
  try {
    callback();
  } catch (error) {
    if (error instanceof RscContractIndexError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected RscContractIndexError to be thrown');
}

describe('indexRscContracts', () => {
  it('forces an otherwise unreferenced client module into the client graph', () => {
    const filename = '/project/src/components/Button.tsx';

    expect(
      indexRscContracts({
        modules: [
          {
            filename,
            source: [
              "'use client';",
              'export type ButtonProps = { label: string };',
              'export function Button() { return null; }',
              'export const buttonVersion = 1;',
            ].join('\n'),
            sourcePath: 'components/Button.tsx',
          },
        ],
        resolve: () => undefined,
      })
    ).toEqual({
      clientEntries: [filename],
      contracts: [
        {
          claim: {
            filename,
            location: { column: 16, line: 3 },
          },
          identity: {
            exportName: 'Button',
            sourcePath: 'components/Button.tsx',
          },
          kind: 'client-reference',
          target: {
            exportName: 'Button',
            filename,
            sourcePath: 'components/Button.tsx',
          },
        },
        {
          claim: {
            filename,
            location: { column: 13, line: 4 },
          },
          identity: {
            exportName: 'buttonVersion',
            sourcePath: 'components/Button.tsx',
          },
          kind: 'client-reference',
          target: {
            exportName: 'buttonVersion',
            filename,
            sourcePath: 'components/Button.tsx',
          },
        },
      ],
    });
  });

  it('maps a static named re-export at an old path to the client implementation', () => {
    const implementationFilename = '/project/src/team/Team.tsx';
    const aliasFilename = '/project/src/Team.tsx';

    expect(
      indexRscContracts({
        modules: [
          {
            filename: aliasFilename,
            source: "export { Team } from './team/Team';",
            sourcePath: 'Team.tsx',
          },
          {
            filename: implementationFilename,
            source: "'use client';\nexport function Team() { return null; }",
            sourcePath: 'team/Team.tsx',
          },
        ],
        resolve: ({ importer, specifier }) =>
          importer === aliasFilename && specifier === './team/Team'
            ? implementationFilename
            : undefined,
      })
    ).toEqual({
      clientEntries: [implementationFilename],
      contracts: [
        {
          claim: {
            filename: aliasFilename,
            location: { column: 9, line: 1 },
          },
          identity: {
            exportName: 'Team',
            sourcePath: 'Team.tsx',
          },
          kind: 'client-reference',
          target: {
            exportName: 'Team',
            filename: implementationFilename,
            sourcePath: 'team/Team.tsx',
          },
        },
        {
          claim: {
            filename: implementationFilename,
            location: { column: 16, line: 2 },
          },
          identity: {
            exportName: 'Team',
            sourcePath: 'team/Team.tsx',
          },
          kind: 'client-reference',
          target: {
            exportName: 'Team',
            filename: implementationFilename,
            sourcePath: 'team/Team.tsx',
          },
        },
      ],
    });
  });

  it('maps a renamed old-path alias to a root implementation', () => {
    const implementationFilename = '/project/src/roots/Team.rsc.tsx';
    const aliasFilename = '/project/src/Team.rsc.tsx';

    expect(
      indexRscContracts({
        modules: [
          {
            filename: implementationFilename,
            source: [
              "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
              'export const Team = defineRscRoot(() => null);',
            ].join('\n'),
            sourcePath: 'roots/Team.rsc.tsx',
          },
          {
            filename: aliasFilename,
            source: "export { Team as LegacyTeam } from './roots/Team.rsc';",
            sourcePath: 'Team.rsc.tsx',
          },
        ],
        resolve: ({ importer, specifier }) =>
          importer === aliasFilename && specifier === './roots/Team.rsc'
            ? implementationFilename
            : undefined,
      })
    ).toEqual({
      clientEntries: [],
      contracts: [
        {
          claim: {
            filename: aliasFilename,
            location: { column: 9, line: 1 },
          },
          identity: {
            exportName: 'LegacyTeam',
            sourcePath: 'Team.rsc.tsx',
          },
          kind: 'root',
          target: {
            exportName: 'Team',
            filename: implementationFilename,
            sourcePath: 'roots/Team.rsc.tsx',
          },
        },
        {
          claim: {
            filename: implementationFilename,
            location: { column: 13, line: 2 },
          },
          identity: {
            exportName: 'Team',
            sourcePath: 'roots/Team.rsc.tsx',
          },
          kind: 'root',
          target: {
            exportName: 'Team',
            filename: implementationFilename,
            sourcePath: 'roots/Team.rsc.tsx',
          },
        },
      ],
    });
  });

  it('rejects export star when it forwards an RSC contract', () => {
    const implementationFilename = '/project/src/components/Button.tsx';
    const barrelFilename = '/project/src/components/index.ts';
    const error = captureIndexError(() =>
      indexRscContracts({
        modules: [
          {
            filename: barrelFilename,
            source: "export * from './Button';",
            sourcePath: 'components/index.ts',
          },
          {
            filename: implementationFilename,
            source: "'use client';\nexport function Button() { return null; }",
            sourcePath: 'components/Button.tsx',
          },
        ],
        resolve: ({ importer, specifier }) =>
          importer === barrelFilename && specifier === './Button'
            ? implementationFilename
            : undefined,
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_CONTRACT_EXPORT_ALL_UNSUPPORTED',
      filename: barrelFilename,
      location: { column: 0, line: 1 },
      message:
        "RSC contracts cannot be re-exported with export * from './Button'.\n" +
        'Use static named re-exports instead.',
    });
  });

  it('rejects export star declared by a client module', () => {
    const barrelFilename = '/project/src/components/index.ts';
    const valuesFilename = '/project/src/components/values.ts';
    const error = captureIndexError(() =>
      indexRscContracts({
        modules: [
          {
            filename: barrelFilename,
            source: "'use client';\nexport * from './values';",
            sourcePath: 'components/index.ts',
          },
          {
            filename: valuesFilename,
            source: "export const label = 'Team';",
            sourcePath: 'components/values.ts',
          },
        ],
        resolve: ({ importer, specifier }) =>
          importer === barrelFilename && specifier === './values'
            ? valuesFilename
            : undefined,
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_CONTRACT_EXPORT_ALL_UNSUPPORTED',
      filename: barrelFilename,
      location: { column: 0, line: 2 },
    });
  });

  it('rejects two modules claiming the same logical identity', () => {
    const error = captureIndexError(() =>
      indexRscContracts({
        modules: [
          {
            filename: '/project/a/Button.tsx',
            source: "'use client';\nexport function Button() { return null; }",
            sourcePath: 'components/Button.tsx',
          },
          {
            filename: '/project/b/Button.tsx',
            source: "'use client';\nexport function Button() { return null; }",
            sourcePath: 'components/Button.tsx',
          },
        ],
        resolve: () => undefined,
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_CONTRACT_IDENTITY_COLLISION',
      message:
        'RSC contract identity collision for "components/Button.tsx#Button".\n' +
        'Every RSC contract must have one canonical source path and export name.',
    });
  });

  it('locates an identity collision at the current named re-export claim', () => {
    const implementationFilename = '/project/src/components/Button.tsx';
    const firstAliasFilename = '/project/src/legacy/Button.tsx';
    const secondAliasFilename = '/project/src/older/Button.tsx';
    const error = captureIndexError(() =>
      indexRscContracts({
        modules: [
          {
            filename: implementationFilename,
            source: "'use client';\nexport function Button() { return null; }",
            sourcePath: 'components/Button.tsx',
          },
          {
            filename: firstAliasFilename,
            source: "export { Button } from '../components/Button';",
            sourcePath: 'legacy/Button.tsx',
          },
          {
            filename: secondAliasFilename,
            source: [
              '// Deprecated in favor of components/Button.',
              "export { Button } from '../components/Button';",
            ].join('\n'),
            sourcePath: 'legacy/Button.tsx',
          },
        ],
        resolve: ({ importer, specifier }) =>
          specifier === '../components/Button' &&
          (importer === firstAliasFilename || importer === secondAliasFilename)
            ? implementationFilename
            : undefined,
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_CONTRACT_IDENTITY_COLLISION',
      filename: secondAliasFilename,
      location: { column: 9, line: 2 },
    });
  });

  it('keeps logical identities stable when Rspack module IDs change', () => {
    const filename = '/project/src/components/Button.tsx';
    const claims = [
      {
        exportName: 'Button',
        sourcePath: 'components/Button.tsx',
        targetExportName: 'Button',
        targetFilename: filename,
      },
    ] as const;

    const first = createRscClientReferenceContracts({
      claims,
      mode: 'production',
      targets: [
        {
          async: false,
          chunks: [{ file: './chunks/button.js', id: 3 }],
          filename,
          moduleId: 42,
        },
      ],
      unit: 'storefront',
    });
    const second = createRscClientReferenceContracts({
      claims,
      mode: 'production',
      targets: [
        {
          async: false,
          chunks: [{ file: './chunks/button.js', id: 9 }],
          filename,
          moduleId: 77,
        },
      ],
      unit: 'storefront',
    });

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      identity: {
        exportName: 'Button',
        sourcePath: 'components/Button.tsx',
      },
      target: {
        exportName: 'Button',
        moduleId: 42,
      },
    });
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.identity).toEqual(second[0]?.identity);
    expect(second[0]?.target.moduleId).toBe(77);
  });

  it('projects planned aliases onto one authoritative compiled target', () => {
    const targetFilename = '/project/src/team/Team.tsx';

    expect(
      createRscClientReferenceContracts({
        claims: [
          {
            exportName: 'LegacyTeam',
            sourcePath: 'Team.tsx',
            targetExportName: 'Team',
            targetFilename,
          },
          {
            exportName: 'Team',
            sourcePath: 'team/Team.tsx',
            targetExportName: 'Team',
            targetFilename,
          },
        ],
        mode: 'development',
        targets: [
          {
            async: true,
            chunks: [{ file: './team.chunk.js', id: 7 }],
            filename: targetFilename,
            moduleId: 42,
          },
        ],
        unit: 'widget',
      })
    ).toEqual([
      {
        id: 'rsc:["widget","client-reference","Team.tsx","LegacyTeam"]',
        identity: { exportName: 'LegacyTeam', sourcePath: 'Team.tsx' },
        target: {
          async: true,
          chunks: [{ file: './team.chunk.js', id: 7 }],
          exportName: 'Team',
          moduleId: 42,
        },
      },
      {
        id: 'rsc:["widget","client-reference","team/Team.tsx","Team"]',
        identity: { exportName: 'Team', sourcePath: 'team/Team.tsx' },
        target: {
          async: true,
          chunks: [{ file: './team.chunk.js', id: 7 }],
          exportName: 'Team',
          moduleId: 42,
        },
      },
    ]);
  });

  it('rejects missing and colliding compiled targets during projection', () => {
    const claim = {
      exportName: 'Button',
      sourcePath: 'Button.tsx',
      targetExportName: 'Button',
      targetFilename: '/project/src/Button.tsx',
    } as const;
    const missing = captureIndexError(() =>
      createRscClientReferenceContracts({
        claims: [claim],
        mode: 'production',
        targets: [],
        unit: 'widget',
      })
    );
    expect(missing).toMatchObject({
      code: 'RSC_CLIENT_REFERENCE_TARGET_MISSING',
      filename: claim.targetFilename,
    });

    const target = {
      async: false,
      chunks: [],
      filename: claim.targetFilename,
      moduleId: 1,
    } as const;
    const collision = captureIndexError(() =>
      createRscClientReferenceContracts({
        claims: [claim],
        mode: 'production',
        targets: [target, { ...target, moduleId: 2 }],
        unit: 'widget',
      })
    );
    expect(collision).toMatchObject({
      code: 'RSC_CLIENT_REFERENCE_TARGET_COLLISION',
      filename: claim.targetFilename,
    });
  });
});
