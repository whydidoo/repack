import fs from 'node:fs';
import path from 'node:path';
import { canonicalJsonBytes } from './canonicalJson.js';
import type { RscClientArtifactSet } from './clientArtifactSet.js';
import { collectRscDeploymentFiles } from './deploymentDirectory.js';
import { RscArtifactError } from './errors.js';
import {
  createRscDeploymentManifest,
  createRscPlatformManifest,
} from './index.js';
import { createSha256Inventory } from './inventory.js';
import type { RscDeploymentManifest } from './types.js';

export interface EmitRscDeploymentInput {
  readonly artifactSet: RscClientArtifactSet;
  readonly outputPath: string;
}

export function emitRscDeployment(
  input: EmitRscDeploymentInput
): RscDeploymentManifest {
  const { artifacts: clientArtifacts, layout: artifactLayout } =
    input.artifactSet;
  const layout = artifactLayout.deployment;
  collectRscDeploymentFiles(input.outputPath);
  const serverFilename = path.join(
    input.outputPath,
    layout.entry.bundlerRelative
  );
  if (!fs.existsSync(serverFilename)) {
    throw new RscArtifactError(
      'RSC_ARTIFACT_INVALID_SCHEMA',
      `entry:${layout.entry.persisted}`
    );
  }
  if (!fs.lstatSync(serverFilename).isFile()) {
    throw new RscArtifactError(
      'RSC_ARTIFACT_INVALID_PATH',
      layout.entry.persisted
    );
  }

  for (const expected of layout.platformManifests) {
    const artifact = clientArtifacts.find(
      (candidate) => candidate.platform === expected.platform
    )!;
    const manifest = createRscPlatformManifest(artifact.platformManifest);
    const filename = path.join(input.outputPath, expected.path.bundlerRelative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, manifest.bytes);
  }

  const packageFilename = path.join(
    input.outputPath,
    layout.packageManifest.bundlerRelative
  );
  fs.mkdirSync(path.dirname(packageFilename), { recursive: true });
  fs.writeFileSync(packageFilename, canonicalJsonBytes({ type: 'module' }));

  const files = collectRscDeploymentFiles(input.outputPath).filter(
    (file) => file.path !== layout.manifest.persisted
  );
  const deployment = createRscDeploymentManifest({
    artifacts: createSha256Inventory(files),
    entry: layout.entry.persisted,
    platforms: layout.platformManifests.map((output) => output.platform),
    runtimeVersion: input.artifactSet.runtimeVersion,
    unit: input.artifactSet.unit,
  });
  const deploymentFilename = path.join(
    input.outputPath,
    layout.manifest.bundlerRelative
  );
  fs.mkdirSync(path.dirname(deploymentFilename), { recursive: true });
  fs.writeFileSync(deploymentFilename, deployment.bytes);
  return deployment.value;
}
