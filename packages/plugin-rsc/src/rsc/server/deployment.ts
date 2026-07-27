import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRscDeploymentFiles } from '../artifacts/deploymentDirectory.js';
import { RscArtifactError } from '../artifacts/errors.js';
import {
  parseRscDeploymentManifest,
  parseRscPlatformManifest,
} from '../artifacts/index.js';
import { verifySha256Inventory } from '../artifacts/inventory.js';
import {
  createRscArtifactLayout,
  getRscStaticDeploymentLayout,
} from '../artifacts/layout.js';
import type {
  RscDeploymentManifest,
  RscPlatformManifest,
} from '../artifacts/types.js';

export interface VerifyRscDeploymentAtStartupInput {
  readonly directory: string | URL;
  readonly platforms: readonly string[];
  readonly runtimeVersion: string;
  readonly unit: string;
}

export interface VerifiedRscDeployment {
  readonly deployment: RscDeploymentManifest;
  readonly platformManifests: readonly RscPlatformManifest[];
}

export function verifyRscDeploymentAtStartup(
  input: VerifyRscDeploymentAtStartupInput
): VerifiedRscDeployment {
  const root = path.resolve(
    input.directory instanceof URL
      ? fileURLToPath(input.directory)
      : input.directory
  );
  assertDeploymentDirectory(root);
  const files = collectRscDeploymentFiles(root);
  const staticLayout = getRscStaticDeploymentLayout();
  const deployment = parseRscDeploymentManifest(
    readRequiredFile(
      path.join(root, staticLayout.manifest.bundlerRelative),
      staticLayout.manifest.persisted
    )
  );
  assertExpectedDeployment(deployment, input, staticLayout.entry.persisted);
  const layout = createRscArtifactLayout({
    platforms: input.platforms,
    runtimeVersion: input.runtimeVersion,
    unit: input.unit,
  }).deployment;

  verifySha256Inventory(
    deployment.artifacts,
    files.filter((file) => file.path !== layout.manifest.persisted)
  );
  const filesByPath = new Map(files.map((file) => [file.path, file.bytes]));
  const platformManifests = layout.platformManifests.map((output) => {
    const platform = output.platform;
    const filePath = output.path.persisted;
    const bytes = filesByPath.get(filePath);
    if (!bytes) {
      throw new RscArtifactError('RSC_INVENTORY_MISSING_FILE', filePath);
    }
    const manifest = parseRscPlatformManifest(bytes);
    if (
      manifest.unit !== deployment.unit ||
      manifest.runtimeVersion !== deployment.runtimeVersion ||
      manifest.platform !== platform
    ) {
      throw new RscArtifactError(
        'RSC_ARTIFACT_COORDINATE_MISMATCH',
        `expected ${deployment.unit}@${deployment.runtimeVersion}/${platform}, received ${manifest.unit}@${manifest.runtimeVersion}/${manifest.platform}`
      );
    }
    return manifest;
  });

  return { deployment, platformManifests };
}

function assertDeploymentDirectory(directory: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(directory);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new RscArtifactError('RSC_INVENTORY_MISSING_FILE', '.');
    }
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new RscArtifactError('RSC_ARTIFACT_INVALID_PATH', directory);
  }
}

function assertExpectedDeployment(
  deployment: RscDeploymentManifest,
  expected: VerifyRscDeploymentAtStartupInput,
  expectedEntry: string
): void {
  if (deployment.entry !== expectedEntry) {
    throw new RscArtifactError(
      'RSC_ARTIFACT_INVALID_SCHEMA',
      `entry:${deployment.entry}`
    );
  }
  const expectedPlatforms = [...expected.platforms].sort();
  if (
    deployment.unit !== expected.unit ||
    deployment.runtimeVersion !== expected.runtimeVersion ||
    deployment.platforms.length !== expectedPlatforms.length ||
    deployment.platforms.some(
      (platform, index) => platform !== expectedPlatforms[index]
    )
  ) {
    throw new RscArtifactError(
      'RSC_ARTIFACT_COORDINATE_MISMATCH',
      `expected ${expected.unit}@${expected.runtimeVersion}/${expectedPlatforms.join(',')}, received ${deployment.unit}@${deployment.runtimeVersion}/${deployment.platforms.join(',')}`
    );
  }
}

function readRequiredFile(filename: string, artifactPath: string): Uint8Array {
  try {
    return fs.readFileSync(filename);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new RscArtifactError('RSC_INVENTORY_MISSING_FILE', artifactPath);
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
