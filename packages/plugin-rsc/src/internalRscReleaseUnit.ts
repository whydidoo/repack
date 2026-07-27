import { RepackPlugin } from '@callstack/repack';
import type { Configuration, Compiler as RspackCompiler } from '@rspack/core';
import { loadRspackProjectConfig } from './commands/loadRspackProjectConfig.js';
import { RscConfigurationError } from './configurationError.js';
import { applyRscModuleFederationIsolation } from './moduleFederationIsolation.js';
import type { RscClientArtifactSet } from './rsc/artifacts/clientArtifactSet.js';
import type { RscClientArtifact } from './rsc/artifacts/types.js';
import type { NormalizedRscConfig } from './rsc/config/normalizeRscConfig.js';
import { prepareRscConfig } from './rsc/config/prepareRscConfig.js';
import type { RscPluginConfig } from './rsc/config/types.js';
import { RscRspackPlugin } from './rsc/rspack/RscRspackPlugin.js';
import { createRscSourceCatalog } from './rsc/rspack/sourceCatalog.js';

const releaseUnitConfig = Symbol('RscPlugin.releaseUnitConfig');

/** Adds one React Server Components unit to an existing Re.Pack Rspack configuration. */
export class RscPlugin {
  private readonly [releaseUnitConfig]: RscPluginConfig;

  constructor(config: RscPluginConfig) {
    this[releaseUnitConfig] = config;
  }

  apply(compiler: RspackCompiler): void;

  apply(__compiler: unknown): void {
    const compiler = __compiler as RspackCompiler;
    const rspackVersion = (compiler.webpack as { rspackVersion?: unknown })
      .rspackVersion;
    if (typeof rspackVersion !== 'string') {
      throw new RscConfigurationError(
        'RscPlugin is only supported with Rspack. Use the Rspack Re.Pack commands or remove RscPlugin.'
      );
    }

    const platform = compiler.options.name;
    if (platform !== 'android' && platform !== 'ios') {
      throw new RscConfigurationError(
        `RscPlugin requires platform to be "android" or "ios", received: ${platform}`
      );
    }

    const normalizedConfig = prepareRscConfig(this[releaseUnitConfig], {
      bundler: 'rspack',
      context: compiler.context,
    });
    applyRscModuleFederationIsolation(compiler);
    compiler.hooks.afterPlugins.tap('RscPlugin', () => {
      const { output } = compiler.options;
      if (
        compiler.options.target !== false ||
        output.globalObject !== 'self' ||
        output.chunkFormat !== 'array-push' ||
        output.chunkLoading !== 'jsonp'
      ) {
        throw new RscConfigurationError(
          'RscPlugin requires RepackPlugin (or the equivalent Re.Pack target plugins) in the same Rspack configuration. Add RepackPlugin before or after RscPlugin.'
        );
      }
    });
    new RscRspackPlugin({
      config: normalizedConfig,
      target: compiler.options.devServer
        ? { kind: 'development', platform }
        : { kind: 'mobile', platform },
    }).apply(compiler);
  }
}

export interface DiscoverRscReleaseUnitInput {
  readonly artifactSet: RscClientArtifactSet;
  readonly configPath?: string;
  readonly outputPath: string;
  readonly projectRoot: string;
  readonly reactNativePath: string;
}

export interface RscReleaseUnit {
  readonly serverConfiguration: Configuration;
}

/**
 * Discovers the project plugin for one immutable release coordinate and
 * retains the matching project configuration as the basis of its server build.
 */
export async function discoverRscReleaseUnit(
  input: DiscoverRscReleaseUnitInput
): Promise<RscReleaseUnit> {
  const platformSelections = await Promise.all(
    input.artifactSet.artifacts.map(async (artifact) => {
      const projectConfiguration = await loadRspackProjectConfig({
        configPath: input.configPath,
        platform: artifact.platform,
        projectRoot: input.projectRoot,
        reactNativePath: input.reactNativePath,
      });
      return selectRscReleaseUnit(projectConfiguration, artifact);
    })
  );
  const retained = platformSelections[0]!;

  for (const candidate of platformSelections.slice(1)) {
    if (!areSemanticallyEquivalent(candidate.rsc, retained.rsc)) {
      throw new Error(
        `RscPlugin for ${retained.rsc.name}@${retained.rsc.runtimeVersion} must resolve to the same configuration for every supplied client platform.`
      );
    }
  }

  return {
    serverConfiguration: createRscServerConfiguration({
      artifactSet: input.artifactSet,
      outputPath: input.outputPath,
      projectConfiguration: retained.projectConfiguration,
      rsc: retained.rsc,
    }),
  };
}

interface PlatformSelection {
  readonly projectConfiguration: Configuration;
  readonly rsc: NormalizedRscConfig;
}

function selectRscReleaseUnit(
  projectConfiguration: Configuration,
  artifact: RscClientArtifact
): PlatformSelection {
  if (projectConfiguration.name !== artifact.platform) {
    throw new Error(
      `Rspack configuration name must match RSC client artifact platform ${artifact.platform}.`
    );
  }

  const matchingPlugins = (projectConfiguration.plugins ?? []).filter(
    (plugin): plugin is RscPlugin =>
      plugin instanceof RscPlugin &&
      plugin[releaseUnitConfig].name === artifact.unit &&
      plugin[releaseUnitConfig].runtimeVersion === artifact.runtimeVersion
  );
  const coordinate = `${artifact.unit}@${artifact.runtimeVersion}/${artifact.platform}`;

  if (matchingPlugins.length === 0) {
    throw new Error(
      `The Rspack configuration must contain an RscPlugin matching ${coordinate}.`
    );
  }
  if (matchingPlugins.length > 1) {
    throw new Error(
      `The Rspack configuration contains multiple RscPlugin definitions matching ${coordinate}.`
    );
  }

  const preparedRsc = prepareRscConfig(matchingPlugins[0]![releaseUnitConfig], {
    bundler: 'rspack',
    context: projectConfiguration.context ?? process.cwd(),
  });

  return {
    projectConfiguration,
    rsc: {
      ...preparedRsc,
      server: {
        ...preparedRsc.server,
        roots: createRscSourceCatalog(preparedRsc.server.roots).roots,
      },
    },
  };
}

function areSemanticallyEquivalent(
  left: NormalizedRscConfig,
  right: NormalizedRscConfig
): boolean {
  return (
    left.name === right.name &&
    left.runtimeVersion === right.runtimeVersion &&
    left.runtime === right.runtime &&
    left.server.setup === right.server.setup &&
    left.server.roots.length === right.server.roots.length &&
    left.server.roots.every((root, index) => root === right.server.roots[index])
  );
}

function createRscServerConfiguration(input: {
  readonly artifactSet: RscClientArtifactSet;
  readonly outputPath: string;
  readonly projectConfiguration: Configuration;
  readonly rsc: NormalizedRscConfig;
}): Configuration {
  const projectPlugins = (input.projectConfiguration.plugins ?? []).filter(
    (plugin) =>
      !(plugin instanceof RepackPlugin) && !(plugin instanceof RscPlugin)
  );
  const plugin = new RscRspackPlugin({
    config: input.rsc,
    target: { artifactSet: input.artifactSet, kind: 'server' },
  });

  return {
    context: input.projectConfiguration.context,
    devtool: false,
    entry: {},
    experiments: {
      ...input.projectConfiguration.experiments,
      cache: false,
      layers: true,
    },
    mode: 'production',
    module: input.projectConfiguration.module,
    name: `${input.rsc.name}:rsc-server`,
    optimization: input.projectConfiguration.optimization,
    output: {
      clean: true,
      path: input.outputPath,
    },
    plugins: [...projectPlugins, plugin],
    resolve: input.projectConfiguration.resolve,
    resolveLoader: input.projectConfiguration.resolveLoader,
    target: 'node18',
  };
}
