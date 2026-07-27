import { createRscArtifactLayout } from '../../artifacts/layout.js';
import { RSC_PROTOCOL_VERSION } from '../../protocol/requestMetadata.js';
import {
  type RscContractIndex,
  type RscIndexedContractKind,
  createRscContractId,
} from '../contracts/index.js';
import { validateRscServerArtifacts } from '../validation/validateRscServerArtifacts.js';
import { RscPlanningError } from './errors.js';
import type {
  PlanRscCompilationInput,
  RscCompilationOutputPlan,
  RscCompilationPlan,
  RscPlatform,
  RscServerOutputLayout,
} from './types.js';

export const RSC_INTERNAL_CLIENT_RUNTIME_ID =
  'repack:rsc/internal/client-runtime';
export const RSC_INTERNAL_DEV_SERVER_LOCATION_ID =
  'repack:rsc/internal/dev-server-location';
export const RSC_INTERNAL_DEPLOYMENT_VERIFIER_ID =
  'repack:rsc/internal/deployment-verifier';
export const RSC_INTERNAL_FLIGHT_SERVER_ID =
  'repack:rsc/internal/flight-server';
export const RSC_INTERNAL_SERVER_HANDLER_ID =
  'repack:rsc/internal/server-handler';

function normalizePlatform(platform: string): RscPlatform {
  if (platform !== 'android' && platform !== 'ios') {
    throw new RscPlanningError('RSC_UNSUPPORTED_PLATFORM', platform);
  }
  return platform;
}

export function createRscDevelopmentPath(
  unit: string,
  platform: RscPlatform
): string {
  return `/__repack/rsc/${encodeURIComponent(unit)}/${encodeURIComponent(
    platform
  )}`;
}

function createAddressableContracts(
  index: RscContractIndex,
  kind: Extract<RscIndexedContractKind, 'root' | 'server-function'>,
  unit: string,
  mode: 'development' | 'production'
) {
  return index.contracts
    .filter((contract) => contract.kind === kind)
    .map((contract) => ({
      id: createRscContractId({
        identity: contract.identity,
        kind,
        mode,
        unit,
      }),
      identity: contract.identity,
    }));
}

function createExecutableContracts(
  index: RscContractIndex,
  kind: Extract<RscIndexedContractKind, 'root' | 'server-function'>,
  unit: string,
  mode: 'development' | 'production'
) {
  return index.contracts
    .filter((contract) => contract.kind === kind)
    .map((contract) => ({
      exportName: contract.target.exportName,
      id: createRscContractId({
        identity: contract.identity,
        kind,
        mode,
        unit,
      }),
      module: contract.target.filename,
    }));
}

function createClientReferenceClaims(
  index: RscContractIndex,
  unit: string,
  mode: 'development' | 'production'
) {
  return index.contracts
    .filter((contract) => contract.kind === 'client-reference')
    .map((contract) => ({
      exportName: contract.identity.exportName,
      filename: contract.claim.filename,
      id: createRscContractId({
        identity: contract.identity,
        kind: 'client-reference',
        mode,
        unit,
      }),
      sourcePath: contract.identity.sourcePath,
      targetExportName: contract.target.exportName,
      targetFilename: contract.target.filename,
    }));
}

function createClientGraphEntries(
  index: RscContractIndex,
  clientRuntimeId: string
): readonly string[] {
  return [
    clientRuntimeId,
    ...new Set(
      index.contracts
        .filter((contract) => contract.kind !== 'client-reference')
        .map((contract) => contract.target.filename)
    ),
  ];
}

export function planRscCompilation(
  input: PlanRscCompilationInput
): RscCompilationPlan {
  const { config, target } = input;
  const clientRuntimeId = `repack:rsc/${config.name}/client-runtime`;
  const serverRuntimeId = `repack:rsc/${config.name}/server-runtime`;
  const mode = target.kind === 'development' ? 'development' : 'production';
  const roots = createAddressableContracts(
    input.contractIndex,
    'root',
    config.name,
    mode
  );
  const serverFunctions = createAddressableContracts(
    input.contractIndex,
    'server-function',
    config.name,
    mode
  );
  const clientReferenceClaims = createClientReferenceClaims(
    input.contractIndex,
    config.name,
    mode
  );
  const clientGraphEntries = createClientGraphEntries(
    input.contractIndex,
    clientRuntimeId
  );

  if (target.kind !== 'server') {
    normalizePlatform(target.platform);
  }

  if (target.kind === 'server') {
    if (
      target.artifactSet.unit !== config.name ||
      target.artifactSet.runtimeVersion !== config.runtimeVersion
    ) {
      throw new RscPlanningError(
        'RSC_CLIENT_ARTIFACT_MISMATCH',
        `expected ${config.name}@${config.runtimeVersion}, received ${target.artifactSet.unit}@${target.artifactSet.runtimeVersion}`
      );
    }

    const {
      artifacts: clientArtifacts,
      layout: artifactLayout,
      platforms,
    } = target.artifactSet;
    validateRscServerArtifacts({
      clientArtifacts,
      contractIndex: input.contractIndex,
      unit: config.name,
    });

    return {
      clientEntries: input.contractIndex.clientEntries,
      clientReferenceClaims,
      generatedModules: [
        {
          graph: 'server',
          id: serverRuntimeId,
          input: {
            deploymentStartupModule: `repack:rsc/${config.name}/deployment-startup`,
            development: false,
            flightServerModule: RSC_INTERNAL_FLIGHT_SERVER_ID,
            handlerModule: RSC_INTERNAL_SERVER_HANDLER_ID,
            platformResolverModules: platforms.map(
              (platform) =>
                `repack:rsc/${config.name}/client-references/${platform}`
            ),
            roots: createExecutableContracts(
              input.contractIndex,
              'root',
              config.name,
              'production'
            ),
            runtimeVersion: config.runtimeVersion,
            serverFunctions: createExecutableContracts(
              input.contractIndex,
              'server-function',
              config.name,
              'production'
            ),
            setupModule: config.server.setup,
            unit: config.name,
          },
          role: 'server-runtime',
        },
        {
          graph: 'server',
          id: `repack:rsc/${config.name}/deployment-startup`,
          input: {
            platforms,
            runtimeVersion: config.runtimeVersion,
            unit: config.name,
            verifierModule: RSC_INTERNAL_DEPLOYMENT_VERIFIER_ID,
          },
          role: 'deployment-startup',
        },
        ...platforms.map((platform) => ({
          graph: 'server' as const,
          id: `repack:rsc/${config.name}/client-references/${platform}`,
          input: {
            platformManifest: clientArtifacts.find(
              (artifact) => artifact.platform === platform
            )!.platformManifest,
          },
          platform,
          role: 'client-reference-resolver' as const,
        })),
      ],
      graphs: [
        {
          entries: [serverRuntimeId],
          entryOutput: {
            kind: 'deployment-entry',
          },
          kind: 'server',
          name: `${config.name}:server`,
          platforms,
        },
      ],
      kind: target.kind,
      moduleReplacements: [],
      outputs: [
        {
          entry: serverRuntimeId,
          kind: 'server-entry',
          path: artifactLayout.deployment.entry.bundlerRelative,
        },
        {
          kind: 'deployment-manifest',
          path: artifactLayout.deployment.manifest.bundlerRelative,
        },
        {
          kind: 'package-manifest',
          path: artifactLayout.deployment.packageManifest.bundlerRelative,
          type: 'module',
        },
        ...platforms.map((platform) => {
          const output = artifactLayout.deployment.platformManifests.find(
            (candidate) => candidate.platform === platform
          )!;
          const artifact = clientArtifacts.find(
            (candidate) => candidate.platform === platform
          )!;
          return {
            kind: 'platform-manifest' as const,
            manifest: artifact.platformManifest,
            path: output.path.bundlerRelative,
            platform,
          };
        }),
      ],
      platforms,
      runtimeVersion: config.runtimeVersion,
      unit: config.name,
    };
  }

  if (target.kind === 'mobile') {
    const artifactLayout = createRscArtifactLayout({
      platforms: [target.platform],
      runtimeVersion: config.runtimeVersion,
      unit: config.name,
    });
    const clientLayout = artifactLayout.clients[0]!;
    return {
      clientEntries: input.contractIndex.clientEntries,
      clientReferenceClaims,
      generatedModules: [
        {
          graph: 'client',
          id: clientRuntimeId,
          input: {
            context: {
              development: false,
              platform: target.platform,
              runtimeVersion: config.runtimeVersion,
              unit: config.name,
            },
            roots,
            runtimeModule: `repack:rsc/${config.name}/application-runtime`,
            serverFunctions,
          },
          role: 'client-runtime',
        },
        {
          graph: 'client',
          id: `repack:rsc/${config.name}/platform-manifest`,
          role: 'platform-manifest',
        },
      ],
      graphs: [
        {
          entries: clientGraphEntries,
          entryOutput: {
            path: clientLayout.bundle,
            when: 'static-entry-filename',
          },
          kind: 'client',
          name: `${config.name}:client:${target.platform}`,
          platform: target.platform,
        },
      ],
      kind: target.kind,
      moduleReplacements: [
        {
          replacement: config.runtime,
          request: `repack:rsc/${config.name}/application-runtime`,
        },
      ],
      outputs: [
        {
          kind: 'client-artifact',
          path: clientLayout.artifact,
          platform: target.platform,
          roots,
          serverFunctions,
        },
      ],
      platforms: [target.platform],
      runtimeVersion: config.runtimeVersion,
      unit: config.name,
    };
  }

  return {
    clientEntries: input.contractIndex.clientEntries,
    clientReferenceClaims,
    generatedModules: [
      {
        graph: 'client',
        id: clientRuntimeId,
        input: {
          context: {
            development: true,
            platform: target.platform,
            runtimeVersion: config.runtimeVersion,
            unit: config.name,
          },
          roots,
          runtimeModule: `repack:rsc/${config.name}/dev-transport`,
          serverFunctions,
        },
        role: 'client-runtime',
      },
      {
        graph: 'client',
        id: `repack:rsc/${config.name}/dev-transport`,
        input: {
          devServerLocationModule: RSC_INTERNAL_DEV_SERVER_LOCATION_ID,
          pathname: createRscDevelopmentPath(config.name, target.platform),
        },
        role: 'development-transport',
      },
      {
        graph: 'server',
        id: serverRuntimeId,
        input: {
          development: true,
          flightServerModule: RSC_INTERNAL_FLIGHT_SERVER_ID,
          handlerModule: RSC_INTERNAL_SERVER_HANDLER_ID,
          platformResolverModules: [],
          roots: createExecutableContracts(
            input.contractIndex,
            'root',
            config.name,
            'development'
          ),
          runtimeVersion: config.runtimeVersion,
          serverFunctions: createExecutableContracts(
            input.contractIndex,
            'server-function',
            config.name,
            'development'
          ),
          setupModule: config.server.setup,
          unit: config.name,
        },
        role: 'server-runtime',
      },
      {
        graph: 'server',
        id: `repack:rsc/${config.name}/client-references/${target.platform}`,
        input: {
          platformManifest: {
            clientReferences: [],
            platform: target.platform,
            protocolVersion: RSC_PROTOCOL_VERSION,
            runtimeVersion: config.runtimeVersion,
            schemaVersion: 1,
            unit: config.name,
          },
        },
        platform: target.platform,
        role: 'client-reference-resolver',
      },
    ],
    graphs: [
      {
        entries: clientGraphEntries,
        entryOutput: {
          path: `rsc/${config.name}/development/${target.platform}/client.bundle`,
          when: 'static-entry-filename',
        },
        kind: 'client',
        name: `${config.name}:client:${target.platform}`,
        platform: target.platform,
      },
      {
        entries: [serverRuntimeId],
        entryOutput: {
          kind: 'development-server',
          path: `rsc/${config.name}/development/${target.platform}/server.cjs`,
        },
        kind: 'server',
        name: `${config.name}:server`,
        platforms: [target.platform],
      },
    ],
    kind: target.kind,
    moduleReplacements: [
      {
        replacement: config.runtime,
        request: `repack:rsc/${config.name}/application-runtime`,
      },
    ],
    outputs: [],
    platforms: [target.platform],
    runtimeVersion: config.runtimeVersion,
    unit: config.name,
  };
}

export function getRscServerOutputLayout(
  plan: Pick<RscCompilationPlan, 'outputs'>
): RscServerOutputLayout {
  const one = <Kind extends RscCompilationOutputPlan['kind']>(kind: Kind) => {
    const matches = plan.outputs.filter((output) => output.kind === kind);
    if (matches.length !== 1) {
      throw new Error(
        `RSC server plan must contain exactly one "${kind}" output.`
      );
    }
    return matches[0] as Extract<RscCompilationOutputPlan, { kind: Kind }>;
  };
  return {
    deploymentManifest: one('deployment-manifest'),
    entry: one('server-entry'),
    packageManifest: one('package-manifest'),
    platformManifests: plan.outputs.filter(
      (output) => output.kind === 'platform-manifest'
    ),
  };
}

export type {
  PlanRscCompilationInput,
  PlanRscDevelopmentTarget,
  PlanRscMobileTarget,
  PlanRscServerTarget,
  RscClientGraphPlan,
  RscClientArtifactOutputPlan,
  RscCompilationOutputPlan,
  RscCompilationPlan,
  RscDeploymentManifestOutputPlan,
  RscGeneratedModulePlan,
  RscModuleReplacementPlan,
  RscPackageManifestOutputPlan,
  RscPlatformManifestOutputPlan,
  RscPlatform,
  RscServerEntryOutputPlan,
  RscServerGraphPlan,
  RscServerOutputLayout,
} from './types.js';
export { RscPlanningError } from './errors.js';
export type { RscPlanningErrorCode } from './errors.js';
