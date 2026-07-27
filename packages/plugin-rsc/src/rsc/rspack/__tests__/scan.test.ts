import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRscContractSourceModules } from '../scan.js';
import { createRscSourceCatalog } from '../sourceCatalog.js';

describe('scanRscContractSourceModules', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-scan-'))
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  });

  it('reads supported source modules with deterministic canonical paths', () => {
    const firstRoot = path.join(projectRoot, 'first');
    const secondRoot = path.join(projectRoot, 'second');

    writeFile(firstRoot, 'components/Button.tsx', 'export const Button = 1;');
    writeFile(firstRoot, 'server/action.mts', 'export const action = 1;');
    writeFile(secondRoot, 'flow/View.js', '// @flow\nexport const View = 1;');
    writeFile(firstRoot, '.cache/ignored.ts', 'export const ignored = 1;');
    writeFile(
      firstRoot,
      'node_modules/package/ignored.js',
      'export const ignored = 1;'
    );
    writeFile(firstRoot, 'assets/data.json', '{"not":"source"}');

    expect(
      scanRscContractSourceModules(
        createRscSourceCatalog([firstRoot, secondRoot])
      )
    ).toEqual([
      {
        filename: path.join(firstRoot, 'components/Button.tsx'),
        source: 'export const Button = 1;',
        sourcePath: 'components/Button.tsx',
      },
      {
        filename: path.join(secondRoot, 'flow/View.js'),
        source: '// @flow\nexport const View = 1;',
        sourcePath: 'flow/View.js',
      },
      {
        filename: path.join(firstRoot, 'server/action.mts'),
        source: 'export const action = 1;',
        sourcePath: 'server/action.mts',
      },
    ]);
  });

  it('rejects nested roots instead of assigning identity by root order', () => {
    const sourceRoot = path.join(projectRoot, 'src');
    const nestedRoot = path.join(sourceRoot, 'features');

    writeFile(nestedRoot, 'Profile.ts', 'export const Profile = 1;');

    expect(() => createRscSourceCatalog([sourceRoot, nestedRoot])).toThrow(
      'RSC_SOURCE_ROOT_OVERLAP'
    );
    expect(() => createRscSourceCatalog([nestedRoot, sourceRoot])).toThrow(
      'RSC_SOURCE_ROOT_OVERLAP'
    );
  });

  it('normalizes symlinked roots to the resolver physical filename', () => {
    const physicalRoot = path.join(projectRoot, 'physical');
    const linkedRoot = path.join(projectRoot, 'linked');

    writeFile(physicalRoot, 'Button.tsx', 'export const Button = 1;');
    fs.symlinkSync(physicalRoot, linkedRoot, 'dir');

    expect(
      scanRscContractSourceModules(createRscSourceCatalog([linkedRoot]))
    ).toEqual([
      {
        filename: path.join(physicalRoot, 'Button.tsx'),
        source: 'export const Button = 1;',
        sourcePath: 'Button.tsx',
      },
    ]);
  });

  it('rejects different files with the same canonical source path', () => {
    const firstRoot = path.join(projectRoot, 'first');
    const secondRoot = path.join(projectRoot, 'second');

    writeFile(firstRoot, 'components/Button.tsx', 'export const First = 1;');
    writeFile(secondRoot, 'components/Button.tsx', 'export const Second = 1;');

    expect(() =>
      scanRscContractSourceModules(
        createRscSourceCatalog([secondRoot, firstRoot])
      )
    ).toThrow(
      `Duplicate RSC source path "components/Button.tsx": ${path.join(
        firstRoot,
        'components/Button.tsx'
      )}, ${path.join(secondRoot, 'components/Button.tsx')}`
    );
  });
});

function writeFile(root: string, relativePath: string, source: string): void {
  const filename = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
}
