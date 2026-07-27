import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import semver from 'semver';
import { RscConfigurationError } from '../../configurationError.js';
import {
  type NormalizedRscConfig,
  normalizeRscConfig,
} from './normalizeRscConfig.js';

export interface PrepareRscConfigOptions {
  readonly bundler: 'rspack' | 'webpack';
  readonly context: string;
}

const SUPPORTED_RSC_PEER_RANGES = {
  react: '>=19.2.3 <19.3.0',
  'react-server-dom-webpack': '>=19.2.6 <19.3.0',
} as const;

function resolvePackageVersion(
  packageName: keyof typeof SUPPORTED_RSC_PEER_RANGES,
  context: string
): string | undefined {
  try {
    const requireFromContext = createRequire(
      path.join(context, 'package.json')
    );
    const packageJsonPath = requireFromContext.resolve(
      `${packageName}/package.json`
    );
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

export function prepareRscConfig(
  config: unknown,
  options: PrepareRscConfigOptions
): NormalizedRscConfig {
  if (options.bundler === 'webpack') {
    throw new RscConfigurationError(
      'RscPlugin is only supported with Rspack. Use the Rspack Re.Pack commands or remove the rsc option.'
    );
  }

  const normalizedConfig = normalizeRscConfig(config, options.context);

  if (
    !fs.existsSync(normalizedConfig.runtime) ||
    !fs.statSync(normalizedConfig.runtime).isFile()
  ) {
    throw new RscConfigurationError(
      `RscPlugin.runtime does not exist: ${normalizedConfig.runtime}`
    );
  }

  if (
    !fs.existsSync(normalizedConfig.server.setup) ||
    !fs.statSync(normalizedConfig.server.setup).isFile()
  ) {
    throw new RscConfigurationError(
      `RscPlugin.server.setup does not exist: ${normalizedConfig.server.setup}`
    );
  }

  const invalidRoot = normalizedConfig.server.roots.find(
    (root) => !fs.existsSync(root) || !fs.statSync(root).isDirectory()
  );

  if (invalidRoot) {
    throw new RscConfigurationError(
      `RscPlugin.server.roots must contain existing directories: ${invalidRoot}`
    );
  }

  const installedPeerVersions = Object.fromEntries(
    Object.keys(SUPPORTED_RSC_PEER_RANGES).map((packageName) => [
      packageName,
      resolvePackageVersion(
        packageName as keyof typeof SUPPORTED_RSC_PEER_RANGES,
        options.context
      ),
    ])
  ) as Record<keyof typeof SUPPORTED_RSC_PEER_RANGES, string | undefined>;

  const hasSupportedPeers = Object.entries(SUPPORTED_RSC_PEER_RANGES).every(
    ([packageName, supportedRange]) => {
      const installedVersion =
        installedPeerVersions[
          packageName as keyof typeof SUPPORTED_RSC_PEER_RANGES
        ];
      return Boolean(
        installedVersion && semver.satisfies(installedVersion, supportedRange)
      );
    }
  );

  if (!hasSupportedPeers) {
    const installedPeers = Object.entries(installedPeerVersions)
      .map(([packageName, version]) => `${packageName}@${version ?? 'missing'}`)
      .join(' and ');
    throw new RscConfigurationError(
      `RscPlugin does not support the installed RSC dependencies (${installedPeers}). Supported ranges are react@${SUPPORTED_RSC_PEER_RANGES.react} and react-server-dom-webpack@${SUPPORTED_RSC_PEER_RANGES['react-server-dom-webpack']}. Install compatible versions in ${options.context}.`
    );
  }

  return normalizedConfig;
}
