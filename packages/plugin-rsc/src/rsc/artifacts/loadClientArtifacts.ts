import fs from 'node:fs';
import path from 'node:path';
import { parseRscClientArtifact } from './index.js';
import { isRscClientArtifactFilename } from './layout.js';
import type { RscClientArtifact } from './types.js';

export function loadRscClientArtifacts(
  inputPath: string,
  projectRoot: string
): readonly RscClientArtifact[] {
  const requestedPath = path.resolve(projectRoot, inputPath);
  if (!fs.existsSync(requestedPath)) {
    throw new Error(`RSC_CLIENT_ARTIFACT_PATH_NOT_FOUND: ${requestedPath}`);
  }
  const directory = fs.statSync(requestedPath).isDirectory();
  if (
    !directory &&
    !isRscClientArtifactFilename(path.basename(requestedPath))
  ) {
    throw new Error(
      `RSC_CLIENT_ARTIFACT_INVALID_PATH: ${requestedPath} is not named client.json`
    );
  }
  const resolvedPath = fs.realpathSync.native(requestedPath);
  const filenames = directory
    ? collectClientArtifactFilenames(resolvedPath)
    : [resolvedPath];
  if (filenames.length === 0) {
    throw new Error(`RSC_CLIENT_ARTIFACTS_REQUIRED: ${resolvedPath}`);
  }

  return filenames.map(loadClientArtifact);
}

function loadClientArtifact(filename: string): RscClientArtifact {
  try {
    return parseRscClientArtifact(fs.readFileSync(filename));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`RSC_CLIENT_ARTIFACT_INVALID: ${filename}: ${detail}`);
  }
}

function collectClientArtifactFilenames(directory: string): readonly string[] {
  const filenames: string[] = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      filenames.push(...collectClientArtifactFilenames(filename));
    } else if (entry.isFile() && isRscClientArtifactFilename(entry.name)) {
      filenames.push(filename);
    }
  }

  return filenames.sort();
}
