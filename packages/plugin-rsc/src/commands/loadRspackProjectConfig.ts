import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Configuration } from '@rspack/core';

const DEFAULT_CONFIG_LOCATIONS = [
  'rspack.config.mts',
  'rspack.config.cts',
  'rspack.config.ts',
  'rspack.config.mjs',
  'rspack.config.cjs',
  'rspack.config.js',
] as const;

interface RspackConfigEnv {
  readonly context: string;
  readonly minimize: boolean;
  readonly mode: 'production';
  readonly platform: string;
  readonly reactNativePath: string;
}

type ProjectConfig =
  | Configuration
  | ((
      env: RspackConfigEnv,
      argv: Record<string, never>
    ) => Configuration | Promise<Configuration>);

export async function loadRspackProjectConfig(input: {
  readonly configPath?: string;
  readonly platform: string;
  readonly projectRoot: string;
  readonly reactNativePath: string;
}): Promise<Configuration> {
  const filename = findConfigFile(input.projectRoot, input.configPath);
  const loaded = (
    isEsmFile(filename)
      ? await import(pathToFileURL(filename).href)
      : createRequire(path.join(input.projectRoot, 'package.json'))(filename)
  ) as { default?: ProjectConfig } & ProjectConfig;
  const rawConfig = loaded.default ?? loaded;
  const config =
    typeof rawConfig === 'function'
      ? await rawConfig(
          {
            context: input.projectRoot,
            minimize: true,
            mode: 'production',
            platform: input.platform,
            reactNativePath: input.reactNativePath,
          },
          {}
        )
      : { ...rawConfig };

  return {
    ...config,
    context: config.context ?? input.projectRoot,
    mode: 'production',
    name: input.platform,
  };
}

function isEsmFile(filename: string): boolean {
  if (filename.endsWith('.mjs') || filename.endsWith('.mts')) {
    return true;
  }
  if (filename.endsWith('.cjs') || filename.endsWith('.cts')) {
    return false;
  }

  let directory = path.dirname(filename);
  while (true) {
    const packageJsonPath = path.join(directory, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return manifest.type === 'module';
      } catch {
        return false;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return false;
    }
    directory = parent;
  }
}

function findConfigFile(projectRoot: string, configPath?: string): string {
  const candidates = configPath ? [configPath] : DEFAULT_CONFIG_LOCATIONS;
  for (const candidate of candidates) {
    const filename = path.isAbsolute(candidate)
      ? candidate
      : path.join(projectRoot, candidate);
    if (fs.existsSync(filename)) {
      return filename;
    }
  }
  throw new Error('Cannot find Rspack configuration file');
}
