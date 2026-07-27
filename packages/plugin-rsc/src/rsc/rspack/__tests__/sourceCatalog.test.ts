import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRscSourceCatalog } from '../sourceCatalog.js';

describe('createRscSourceCatalog', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-source-catalog-'))
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  });

  it('assigns the same claim independently of configured root order', () => {
    const firstRoot = path.join(projectRoot, 'first');
    const secondRoot = path.join(projectRoot, 'second');
    const filename = writeFile(secondRoot, 'features/Profile.ts');

    expect(
      createRscSourceCatalog([firstRoot, secondRoot]).claim(filename)
    ).toEqual({ filename, sourcePath: 'features/Profile.ts' });
    expect(
      createRscSourceCatalog([secondRoot, firstRoot]).claim(filename)
    ).toEqual({ filename, sourcePath: 'features/Profile.ts' });
  });

  it('normalizes resolver results to the physical source claim', () => {
    const physicalRoot = path.join(projectRoot, 'physical');
    const linkedRoot = path.join(projectRoot, 'linked');
    const physicalFilename = writeFile(physicalRoot, 'Button.tsx');
    fs.symlinkSync(physicalRoot, linkedRoot, 'dir');

    const catalog = createRscSourceCatalog([linkedRoot]);

    expect(catalog.roots).toEqual([physicalRoot]);
    expect(catalog.claim(path.join(linkedRoot, 'Button.tsx'))).toEqual({
      filename: physicalFilename,
      sourcePath: 'Button.tsx',
    });
  });

  it('deduplicates roots that resolve to the same physical directory', () => {
    const physicalRoot = path.join(projectRoot, 'physical');
    const linkedRoot = path.join(projectRoot, 'linked');
    writeFile(physicalRoot, 'Button.tsx');
    fs.symlinkSync(physicalRoot, linkedRoot, 'dir');

    expect(createRscSourceCatalog([linkedRoot, physicalRoot]).roots).toEqual([
      physicalRoot,
    ]);
  });

  it('rejects physical root overlaps in either configured order', () => {
    const root = path.join(projectRoot, 'src');
    const nestedRoot = path.join(root, 'features');
    writeFile(nestedRoot, 'Profile.ts');

    const expected =
      'RSC_SOURCE_ROOT_OVERLAP: RSC source roots must not overlap because one physical source would receive multiple logical paths';
    expect(() => createRscSourceCatalog([root, nestedRoot])).toThrow(expected);
    expect(() => createRscSourceCatalog([nestedRoot, root])).toThrow(expected);
  });

  it('does not claim files outside configured roots', () => {
    const root = path.join(projectRoot, 'src');
    const outside = writeFile(path.join(projectRoot, 'other'), 'Root.tsx');
    fs.mkdirSync(root, { recursive: true });

    expect(createRscSourceCatalog([root]).claim(outside)).toBeUndefined();
  });
});

function writeFile(root: string, relativePath: string): string {
  const filename = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, 'export const value = 1;');
  return filename;
}
