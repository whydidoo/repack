import { createHash } from 'node:crypto';
import { RscArtifactError } from './errors.js';
import { isRscDeploymentManifestPath } from './layout.js';
import { compareStrings } from './ordering.js';
import type {
  RscArtifactInventory,
  RscInventoryFile,
  RscSha256Integrity,
} from './types.js';

const SHA_256_INTEGRITY_PATTERN = /^sha256:[a-f0-9]{64}$/;

function assertArtifactPath(filePath: string): void {
  const segments = filePath.slice(2).split('/');
  if (
    !filePath.startsWith('./') ||
    filePath.includes('\\') ||
    segments.length === 0 ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    ) ||
    isRscDeploymentManifestPath(filePath)
  ) {
    throw new RscArtifactError('RSC_ARTIFACT_INVALID_PATH', filePath);
  }
}

function assertUniquePaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const filePath of paths) {
    assertArtifactPath(filePath);
    if (seen.has(filePath)) {
      throw new RscArtifactError('RSC_ARTIFACT_DUPLICATE_ENTRY', filePath);
    }
    seen.add(filePath);
  }
}

export function calculateSha256(bytes: Uint8Array): RscSha256Integrity {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function createSha256Inventory(
  files: readonly RscInventoryFile[]
): RscArtifactInventory {
  assertUniquePaths(files.map((file) => file.path));

  return Object.fromEntries(
    [...files]
      .sort((left, right) => compareStrings(left.path, right.path))
      .map((file) => [file.path, calculateSha256(file.bytes)])
  );
}

export function verifySha256Inventory(
  expected: RscArtifactInventory,
  files: readonly RscInventoryFile[]
): void {
  const expectedPaths = Object.keys(expected).sort();
  assertUniquePaths(expectedPaths);

  for (const filePath of expectedPaths) {
    if (!SHA_256_INTEGRITY_PATTERN.test(expected[filePath] ?? '')) {
      throw new RscArtifactError('RSC_INVENTORY_HASH_MISMATCH', filePath);
    }
  }

  const actual = createSha256Inventory(files);
  const actualPaths = Object.keys(actual);

  const missingPath = expectedPaths.find((filePath) => !(filePath in actual));
  if (missingPath) {
    throw new RscArtifactError('RSC_INVENTORY_MISSING_FILE', missingPath);
  }

  const unexpectedPath = actualPaths.find(
    (filePath) => !(filePath in expected)
  );
  if (unexpectedPath) {
    throw new RscArtifactError('RSC_INVENTORY_UNEXPECTED_FILE', unexpectedPath);
  }

  const mismatchedPath = expectedPaths.find(
    (filePath) => expected[filePath] !== actual[filePath]
  );
  if (mismatchedPath) {
    throw new RscArtifactError('RSC_INVENTORY_HASH_MISMATCH', mismatchedPath);
  }
}
