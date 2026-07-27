import fs from 'node:fs';
import path from 'node:path';
import { RscArtifactError } from './errors.js';
import { compareStrings } from './ordering.js';
import type { RscInventoryFile } from './types.js';

export function collectRscDeploymentFiles(
  directory: string
): readonly RscInventoryFile[] {
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new RscArtifactError('RSC_ARTIFACT_INVALID_PATH', '.');
  }
  const files: RscInventoryFile[] = [];
  visit(directory, directory, files);
  return files;
}

function visit(
  directory: string,
  root: string,
  files: RscInventoryFile[]
): void {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareStrings(left.name, right.name));
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    const artifactPath = `./${path
      .relative(root, filename)
      .split(path.sep)
      .join('/')}`;
    const stats = fs.lstatSync(filename);
    if (stats.isSymbolicLink()) {
      throw new RscArtifactError('RSC_ARTIFACT_INVALID_PATH', artifactPath);
    }
    if (stats.isDirectory()) {
      visit(filename, root, files);
      continue;
    }
    if (!stats.isFile()) {
      throw new RscArtifactError('RSC_ARTIFACT_INVALID_PATH', artifactPath);
    }
    files.push({ bytes: fs.readFileSync(filename), path: artifactPath });
  }
}
