import fs from 'node:fs';
import path from 'node:path';
import { compareStrings } from '../artifacts/ordering.js';
import type { RscContractSourceModule } from '../compiler/contracts/types.js';
import type { RscSourceCatalog } from './sourceCatalog.js';

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.flow',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

export function scanRscContractSourceModules(
  catalog: RscSourceCatalog
): readonly RscContractSourceModule[] {
  const filenames = new Set<string>();

  for (const root of catalog.roots) {
    collectSourceFilenames(root, filenames);
  }

  const modulesBySourcePath = new Map<string, RscContractSourceModule>();

  for (const filename of [...filenames].sort(compareStrings)) {
    const claim = catalog.claim(filename);
    if (!claim) {
      throw new Error(
        `RSC source file is outside the prepared source catalog: ${filename}`
      );
    }
    const module: RscContractSourceModule = {
      filename: claim.filename,
      source: fs.readFileSync(claim.filename, 'utf8'),
      sourcePath: claim.sourcePath,
    };
    const previous = modulesBySourcePath.get(claim.sourcePath);

    if (previous && previous.filename !== claim.filename) {
      throw new Error(
        `Duplicate RSC source path "${claim.sourcePath}": ${previous.filename}, ${claim.filename}`
      );
    }

    modulesBySourcePath.set(claim.sourcePath, module);
  }

  return [...modulesBySourcePath.values()].sort((left, right) =>
    compareStrings(left.sourcePath, right.sourcePath)
  );
}

function collectSourceFilenames(
  directory: string,
  filenames: Set<string>
): void {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) =>
    compareStrings(left.name, right.name)
  )) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }

    const filename = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectSourceFilenames(filename, filenames);
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      filenames.add(filename);
    }
  }
}
