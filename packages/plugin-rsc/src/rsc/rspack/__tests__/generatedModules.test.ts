import type { RscAddressableContract } from '../../artifacts/types.js';
import type { RscGeneratedModulePlan } from '../../compiler/plan/index.js';
import { generateRscModuleSource } from '../generatedModules.js';

describe('generateRscModuleSource', () => {
  it('generates a deterministic configured client runtime', () => {
    const module: RscGeneratedModulePlan = {
      graph: 'client',
      id: 'repack:rsc/widget/client-runtime',
      input: {
        context: {
          development: false,
          platform: 'ios',
          runtimeVersion: '7',
          unit: 'widget',
        },
        roots: [addressable('rsc_root_4d31', 'Team', 'roots/Team.rsc.tsx')],
        runtimeModule: 'repack:rsc/widget/application-runtime',
        serverFunctions: [
          addressable(
            'rsc_action_42',
            'checkMe',
            'functions/checkMe.server.ts'
          ),
        ],
      },
      role: 'client-runtime',
    };

    const source = generateRscModuleSource(module);
    expect(source).toContain(
      'import runtimeConfig from "repack:rsc/widget/application-runtime";'
    );
    expect(source).toContain(
      'context: Object.freeze({"development":false,"platform":"ios","runtimeVersion":"7","unit":"widget"})'
    );
    expect(source).toContain(
      'roots: Object.freeze([{"id":"rsc_root_4d31","identity":{"exportName":"Team","sourcePath":"roots/Team.rsc.tsx"}}])'
    );
    expect(source).toContain('module.hot.dispose');
    expect(generateRscModuleSource({ ...module })).toBe(source);
  });

  it('normalizes unordered addressable contracts in generated client source', () => {
    const input = {
      context: {
        development: false,
        platform: 'ios' as const,
        runtimeVersion: '7',
        unit: 'widget',
      },
      runtimeModule: 'repack:rsc/widget/application-runtime',
    };
    const createModule = (
      roots: readonly RscAddressableContract[],
      serverFunctions: readonly RscAddressableContract[]
    ): RscGeneratedModulePlan => ({
      graph: 'client',
      id: 'repack:rsc/widget/client-runtime',
      input: { ...input, roots, serverFunctions },
      role: 'client-runtime',
    });
    const team = addressable('rsc_root_team', 'Team', 'roots/Team.rsc.tsx');
    const home = addressable('rsc_root_home', 'Home', 'roots/Home.rsc.tsx');
    const checkMe = addressable(
      'rsc_action_check',
      'checkMe',
      'functions/checkMe.server.ts'
    );
    const updateMe = addressable(
      'rsc_action_update',
      'updateMe',
      'functions/updateMe.server.ts'
    );

    expect(
      generateRscModuleSource(createModule([team, home], [updateMe, checkMe]))
    ).toBe(
      generateRscModuleSource(createModule([home, team], [checkMe, updateMe]))
    );
  });

  it('generates the development transport and placeholder manifest', () => {
    expect(
      generateRscModuleSource({
        graph: 'client',
        id: 'repack:rsc/widget/dev-transport',
        input: {
          devServerLocationModule: 'repack:rsc/internal/dev-server-location',
          pathname: '/__repack/rsc/widget/ios',
        },
        role: 'development-transport',
      })
    ).toContain(
      'new URL("/__repack/rsc/widget/ios", getDevServerLocation().origin)'
    );
    expect(
      generateRscModuleSource({
        graph: 'client',
        id: 'repack:rsc/widget/platform-manifest',
        role: 'platform-manifest',
      })
    ).toBe('export default Object.freeze({});\n');
  });

  it('generates configured production and development server runtimes', () => {
    const production = generateRscModuleSource(
      serverRuntimePlan({
        deploymentStartupModule: 'repack:rsc/widget/deployment-startup',
        development: false,
        platformResolverModules: [
          'repack:rsc/widget/client-references/ios',
          'repack:rsc/widget/client-references/android',
        ],
      })
    );
    expect(production).toContain(
      'import "repack:rsc/widget/deployment-startup";'
    );
    expect(production.indexOf('client-references/android')).toBeLessThan(
      production.indexOf('client-references/ios')
    );
    expect(production).toContain('export const handler = createRscHandler');
    expect(production).toContain('export default handler;');

    const development = generateRscModuleSource(
      serverRuntimePlan({ development: true, platformResolverModules: [] })
    );
    expect(development).toContain(
      'export function createHandler(platformManifests) {'
    );
    expect(development).not.toContain('export default handler;');
  });

  it('generates deployment verification and a frozen platform resolver', () => {
    const startup = generateRscModuleSource({
      graph: 'server',
      id: 'repack:rsc/widget/deployment-startup',
      input: {
        platforms: ['ios', 'android'],
        runtimeVersion: '7',
        unit: 'widget',
        verifierModule: 'repack:rsc/internal/deployment-verifier',
      },
      role: 'deployment-startup',
    });
    expect(startup).toContain('platforms: ["android","ios"]');
    expect(startup).not.toContain('deployment.json');
    expect(startup).not.toContain('manifests/');

    expect(
      generateRscModuleSource({
        graph: 'server',
        id: 'repack:rsc/widget/client-references/ios',
        input: {
          platformManifest: {
            clientReferences: [],
            platform: 'ios',
            protocolVersion: 1,
            runtimeVersion: '7',
            schemaVersion: 1,
            unit: 'widget',
          },
        },
        platform: 'ios',
        role: 'client-reference-resolver',
      })
    ).toBe(
      'export default Object.freeze({"clientReferences":[],"platform":"ios","protocolVersion":1,"runtimeVersion":"7","schemaVersion":1,"unit":"widget"});\n'
    );
  });
});

function addressable(id: string, exportName: string, sourcePath: string) {
  return { id, identity: { exportName, sourcePath } };
}

function serverRuntimePlan(
  input: Readonly<{
    deploymentStartupModule?: string;
    development: boolean;
    platformResolverModules: readonly string[];
  }>
): RscGeneratedModulePlan {
  return {
    graph: 'server',
    id: 'repack:rsc/widget/server-runtime',
    input: {
      ...input,
      flightServerModule: 'react-server-dom-webpack/server.edge',
      handlerModule: 'repack:rsc/internal/server-handler',
      roots: [
        {
          exportName: 'Team',
          id: 'rsc_root_team',
          module: '/project/src/Team.rsc.tsx',
        },
      ],
      runtimeVersion: '7',
      serverFunctions: [
        {
          exportName: 'checkMe',
          id: 'rsc_action_check',
          module: '/project/src/checkMe.server.ts',
        },
      ],
      setupModule: '/project/src/rsc.server.ts',
      unit: 'widget',
    },
    role: 'server-runtime',
  };
}
