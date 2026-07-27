import fs from 'node:fs';
import path from 'node:path';
import { compareStrings } from '../artifacts/ordering.js';

export interface RscSourceClaim {
  /** The physical filename shared with the Rspack resolver. */
  readonly filename: string;
  /** The stable, root-relative path used in RSC logical identities. */
  readonly sourcePath: string;
}

export interface RscSourceCatalog {
  /** Physical, de-duplicated roots in deterministic order. */
  readonly roots: readonly string[];
  /** Returns the one canonical claim for a source inside the catalog. */
  claim(filename: string): RscSourceClaim | undefined;
}

export function createRscSourceCatalog(
  configuredRoots: readonly string[]
): RscSourceCatalog {
  const roots = [...new Set(configuredRoots.map(toPhysicalFilename))].sort(
    compareStrings
  );

  for (let index = 0; index < roots.length; index += 1) {
    const ancestor = roots[index];
    if (!ancestor) {
      continue;
    }
    for (
      let candidateIndex = index + 1;
      candidateIndex < roots.length;
      candidateIndex += 1
    ) {
      const descendant = roots[candidateIndex];
      if (descendant && isInside(ancestor, descendant)) {
        throw new Error(
          'RSC_SOURCE_ROOT_OVERLAP: RSC source roots must not overlap because ' +
            'one physical source would receive multiple logical paths: ' +
            `"${ancestor}" and "${descendant}".`
        );
      }
    }
  }

  return Object.freeze({
    roots: Object.freeze(roots),
    claim(filename: string): RscSourceClaim | undefined {
      const physicalFilename = toPhysicalFilename(filename);
      const root = roots.find((candidate) =>
        isInside(candidate, physicalFilename)
      );
      if (!root) {
        return undefined;
      }
      return Object.freeze({
        filename: physicalFilename,
        sourcePath: path
          .relative(root, physicalFilename)
          .split(path.sep)
          .join('/'),
      });
    },
  });
}

/** Normalize an untrusted resolver/compiler filename to its physical spelling. */
export function toPhysicalFilename(filename: string): string {
  const absoluteFilename = path.resolve(filename);
  try {
    return fs.realpathSync.native(absoluteFilename);
  } catch {
    return absoluteFilename;
  }
}

function isInside(root: string, filename: string): boolean {
  const relativePath = path.relative(root, filename);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}
