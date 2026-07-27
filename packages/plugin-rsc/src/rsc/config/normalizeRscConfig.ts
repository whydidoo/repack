import path from 'node:path';
import { RscConfigurationError } from '../../configurationError.js';
import type { RscPluginConfig } from './types.js';

const UNIT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RUNTIME_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export interface NormalizedRscConfig {
  readonly name: string;
  readonly runtimeVersion: string;
  readonly runtime: string;
  readonly server: {
    readonly roots: readonly string[];
    readonly setup: string;
  };
}

export function normalizeRscConfig(
  input: unknown,
  context: string
): NormalizedRscConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new RscConfigurationError('RscPlugin must be an object.');
  }

  const inputRecord = input as Record<string, unknown>;
  if (
    typeof inputRecord.server !== 'object' ||
    inputRecord.server === null ||
    Array.isArray(inputRecord.server)
  ) {
    throw new RscConfigurationError('RscPlugin.server must be an object.');
  }

  const config = input as RscPluginConfig;

  if (typeof config.name !== 'string' || !UNIT_NAME_PATTERN.test(config.name)) {
    throw new RscConfigurationError(
      'RscPlugin.name must be a non-empty path-safe identifier containing only letters, numbers, ".", "_" or "-".'
    );
  }

  if (
    typeof config.runtimeVersion !== 'string' ||
    !RUNTIME_VERSION_PATTERN.test(config.runtimeVersion)
  ) {
    throw new RscConfigurationError(
      'RscPlugin.runtimeVersion must be a non-empty path-safe identifier containing only letters, numbers, ".", "_", "+" or "-".'
    );
  }

  if (typeof config.runtime !== 'string' || config.runtime.trim() === '') {
    throw new RscConfigurationError(
      'RscPlugin.runtime must be a non-empty module path.'
    );
  }

  if (
    typeof config.server.setup !== 'string' ||
    config.server.setup.trim() === ''
  ) {
    throw new RscConfigurationError(
      'RscPlugin.server.setup must be a non-empty module path.'
    );
  }

  if (
    !Array.isArray(config.server.roots) ||
    config.server.roots.length === 0 ||
    config.server.roots.some(
      (root) => typeof root !== 'string' || root.trim() === ''
    )
  ) {
    throw new RscConfigurationError(
      'RscPlugin.server.roots must contain at least one non-empty path.'
    );
  }

  return {
    name: config.name,
    runtimeVersion: config.runtimeVersion,
    runtime: path.resolve(context, config.runtime),
    server: {
      roots: config.server.roots.map((root) => path.resolve(context, root)),
      setup: path.resolve(context, config.server.setup),
    },
  };
}
