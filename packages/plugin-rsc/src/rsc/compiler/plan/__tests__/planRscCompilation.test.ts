import { createRscClientArtifactSet } from '../../../artifacts/clientArtifactSet.js';
import { createRscClientArtifact } from '../../../artifacts/index.js';
import type { RscContractIndex } from '../../contracts/index.js';
import { type PlanRscCompilationInput, planRscCompilation } from '../index.js';

const EMPTY_CONTRACT_INDEX = Object.freeze({
  clientEntries: [],
  contracts: [],
});

function plan(input: Omit<PlanRscCompilationInput, 'contractIndex'>) {
  return planRscCompilation({ ...input, contractIndex: EMPTY_CONTRACT_INDEX });
}

function createConfig() {
  return {
    name: 'widget',
    runtime: '/does/not/exist/rsc.runtime.ts',
    runtimeVersion: '7',
    server: {
      roots: ['/does/not/exist/src'],
      setup: '/does/not/exist/rsc.server.ts',
    },
  } as const;
}

function createClientArtifact(
  platform: string,
  coordinate: {
    runtimeVersion: string;
    unit: string;
  } = {
    runtimeVersion: '7',
    unit: 'widget',
  }
) {
  return createRscClientArtifact({
    platform,
    platformManifest: {
      clientReferences: [],
      platform,
      runtimeVersion: coordinate.runtimeVersion,
      unit: coordinate.unit,
    },
    roots: [],
    runtimeVersion: coordinate.runtimeVersion,
    serverFunctions: [],
    unit: coordinate.unit,
  }).value;
}

describe('planRscCompilation', () => {
  it('owns contract-derived runtime composition and artifact intent', () => {
    const contractIndex: RscContractIndex = {
      clientEntries: ['/project/src/Button.tsx'],
      contracts: [
        contract('root', 'Team', 'Team.rsc.tsx'),
        contract('server-function', 'checkMe', 'checkMe.server.ts'),
        contract('client-reference', 'Button', 'Button.tsx'),
      ],
    };

    const result = planRscCompilation({
      config: createConfig(),
      contractIndex,
      target: { kind: 'mobile', platform: 'ios' },
    });
    const runtime = result.generatedModules.find(
      (module) => module.role === 'client-runtime'
    );
    const output = result.outputs.find(
      (candidate) => candidate.kind === 'client-artifact'
    );

    expect(result.clientEntries).toEqual(['/project/src/Button.tsx']);
    expect(result.clientReferenceClaims).toEqual([
      expect.objectContaining({
        exportName: 'Button',
        filename: '/project/src/Button.tsx',
        targetExportName: 'Button',
      }),
    ]);
    expect(result.graphs[0]?.entries).toEqual([
      'repack:rsc/widget/client-runtime',
      '/project/src/Team.rsc.tsx',
      '/project/src/checkMe.server.ts',
    ]);
    expect(runtime).toMatchObject({
      input: {
        roots: [
          { identity: { exportName: 'Team', sourcePath: 'Team.rsc.tsx' } },
        ],
        serverFunctions: [
          {
            identity: {
              exportName: 'checkMe',
              sourcePath: 'checkMe.server.ts',
            },
          },
        ],
      },
    });
    expect(output).toMatchObject({
      roots: runtime?.role === 'client-runtime' ? runtime.input.roots : [],
      serverFunctions:
        runtime?.role === 'client-runtime' ? runtime.input.serverFunctions : [],
    });
  });

  it('plans isolated iOS client and server graphs for development', () => {
    const input: Omit<PlanRscCompilationInput, 'contractIndex'> = Object.freeze(
      {
        config: createConfig(),
        target: Object.freeze({
          kind: 'development',
          platform: 'ios',
        }),
      }
    );

    expect(plan(input)).toMatchObject({
      generatedModules: [
        {
          graph: 'client',
          id: 'repack:rsc/widget/client-runtime',
          role: 'client-runtime',
        },
        {
          graph: 'client',
          id: 'repack:rsc/widget/dev-transport',
          role: 'development-transport',
        },
        {
          graph: 'server',
          id: 'repack:rsc/widget/server-runtime',
          role: 'server-runtime',
        },
        {
          graph: 'server',
          id: 'repack:rsc/widget/client-references/ios',
          platform: 'ios',
          role: 'client-reference-resolver',
        },
      ],
      graphs: [
        {
          entries: ['repack:rsc/widget/client-runtime'],
          kind: 'client',
          name: 'widget:client:ios',
          platform: 'ios',
        },
        {
          entries: ['repack:rsc/widget/server-runtime'],
          kind: 'server',
          name: 'widget:server',
          platforms: ['ios'],
        },
      ],
      kind: 'development',
      outputs: [],
      platforms: ['ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });
  });

  it('plans an Android mobile graph and immutable client artifact', () => {
    expect(
      plan({
        config: createConfig(),
        target: {
          kind: 'mobile',
          platform: 'android',
        },
      })
    ).toMatchObject({
      generatedModules: [
        {
          graph: 'client',
          id: 'repack:rsc/widget/client-runtime',
          role: 'client-runtime',
        },
        {
          graph: 'client',
          id: 'repack:rsc/widget/platform-manifest',
          role: 'platform-manifest',
        },
      ],
      graphs: [
        {
          entries: ['repack:rsc/widget/client-runtime'],
          kind: 'client',
          name: 'widget:client:android',
          platform: 'android',
        },
      ],
      kind: 'mobile',
      outputs: [
        {
          kind: 'client-artifact',
          path: 'rsc/widget/7/android/client.json',
          platform: 'android',
        },
      ],
      platforms: ['android'],
      runtimeVersion: '7',
      unit: 'widget',
    });
  });

  it('plans one server graph from multiple platform client artifacts', () => {
    const ios = createClientArtifact('ios');
    const android = createClientArtifact('android');

    expect(
      plan({
        config: createConfig(),
        target: {
          artifactSet: createRscClientArtifactSet([ios, android]),
          kind: 'server',
        },
      })
    ).toMatchObject({
      generatedModules: [
        {
          graph: 'server',
          id: 'repack:rsc/widget/server-runtime',
          role: 'server-runtime',
        },
        {
          graph: 'server',
          id: 'repack:rsc/widget/deployment-startup',
          role: 'deployment-startup',
        },
        {
          graph: 'server',
          id: 'repack:rsc/widget/client-references/android',
          platform: 'android',
          role: 'client-reference-resolver',
        },
        {
          graph: 'server',
          id: 'repack:rsc/widget/client-references/ios',
          platform: 'ios',
          role: 'client-reference-resolver',
        },
      ],
      graphs: [
        {
          entries: ['repack:rsc/widget/server-runtime'],
          kind: 'server',
          name: 'widget:server',
          platforms: ['android', 'ios'],
        },
      ],
      kind: 'server',
      outputs: [
        {
          entry: 'repack:rsc/widget/server-runtime',
          kind: 'server-entry',
          path: 'server.js',
        },
        {
          kind: 'deployment-manifest',
          path: 'deployment.json',
        },
        {
          kind: 'package-manifest',
          path: 'package.json',
          type: 'module',
        },
        {
          kind: 'platform-manifest',
          manifest: android.platformManifest,
          path: 'manifests/android.json',
          platform: 'android',
        },
        {
          kind: 'platform-manifest',
          manifest: ios.platformManifest,
          path: 'manifests/ios.json',
          platform: 'ios',
        },
      ],
      platforms: ['android', 'ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });
  });

  it('rejects an unsupported mobile platform during planning', () => {
    const input = {
      config: createConfig(),
      target: {
        kind: 'mobile',
        platform: 'web',
      },
    } as unknown as Omit<PlanRscCompilationInput, 'contractIndex'>;

    expect(() => plan(input)).toThrow('RSC_UNSUPPORTED_PLATFORM: web');
  });

  it('rejects a client artifact for another unit', () => {
    expect(() =>
      plan({
        config: createConfig(),
        target: {
          artifactSet: createRscClientArtifactSet([
            createClientArtifact('ios', {
              runtimeVersion: '7',
              unit: 'other-widget',
            }),
          ]),
          kind: 'server',
        },
      })
    ).toThrow(
      'RSC_CLIENT_ARTIFACT_MISMATCH: expected widget@7, received other-widget@7'
    );
  });

  it('rejects a client artifact for another runtime version', () => {
    expect(() =>
      plan({
        config: createConfig(),
        target: {
          artifactSet: createRscClientArtifactSet([
            createClientArtifact('android', {
              runtimeVersion: '8',
              unit: 'widget',
            }),
          ]),
          kind: 'server',
        },
      })
    ).toThrow(
      'RSC_CLIENT_ARTIFACT_MISMATCH: expected widget@7, received widget@8'
    );
  });
});

function contract(
  kind: 'client-reference' | 'root' | 'server-function',
  exportName: string,
  sourcePath: string
): RscContractIndex['contracts'][number] {
  return {
    claim: {
      filename: `/project/src/${sourcePath}`,
      location: { column: 0, line: 1 },
    },
    identity: { exportName, sourcePath },
    kind,
    target: {
      exportName,
      filename: `/project/src/${sourcePath}`,
      sourcePath,
    },
  };
}
