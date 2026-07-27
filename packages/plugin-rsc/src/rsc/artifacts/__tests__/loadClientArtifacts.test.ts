import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRscClientArtifact } from '../index.js';
import { loadRscClientArtifacts } from '../loadClientArtifacts.js';

describe('loadRscClientArtifacts', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-artifacts-'))
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  });

  it('loads an explicitly supplied client.json relative to the project root', () => {
    const artifact = createClientArtifact('ios');
    const filename = path.join(projectRoot, 'release', 'client.json');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, artifact.bytes);

    expect(loadRscClientArtifacts('release/client.json', projectRoot)).toEqual([
      artifact.value,
    ]);
  });

  it('recursively loads only client.json files in deterministic path order without deduplicating', () => {
    const android = createClientArtifact('android');
    const ios = createClientArtifact('ios');
    writeArtifact('artifacts/z/client.json', ios.bytes);
    writeArtifact('artifacts/a/client.json', android.bytes);
    writeArtifact('artifacts/b/nested/client.json', ios.bytes);
    writeArtifact('artifacts/c/artifact.json', android.bytes);
    writeArtifact('artifacts/client.json.backup', ios.bytes);

    expect(loadRscClientArtifacts('artifacts', projectRoot)).toEqual([
      android.value,
      ios.value,
      ios.value,
    ]);
  });

  it('rejects an explicit file that is not named client.json', () => {
    writeArtifact('release/artifact.json', createClientArtifact('ios').bytes);

    expect(() =>
      loadRscClientArtifacts('release/artifact.json', projectRoot)
    ).toThrow(
      `RSC_CLIENT_ARTIFACT_INVALID_PATH: ${path.join(
        projectRoot,
        'release/artifact.json'
      )} is not named client.json`
    );
  });

  it('does not accept a differently named symlink to client.json', () => {
    writeArtifact('release/client.json', createClientArtifact('ios').bytes);
    fs.symlinkSync(
      path.join(projectRoot, 'release', 'client.json'),
      path.join(projectRoot, 'release', 'artifact.json'),
      'file'
    );

    expect(() =>
      loadRscClientArtifacts('release/artifact.json', projectRoot)
    ).toThrow(
      `RSC_CLIENT_ARTIFACT_INVALID_PATH: ${path.join(
        projectRoot,
        'release/artifact.json'
      )} is not named client.json`
    );
  });

  it('reports the resolved path when the supplied path does not exist', () => {
    expect(() => loadRscClientArtifacts('missing', projectRoot)).toThrow(
      `RSC_CLIENT_ARTIFACT_PATH_NOT_FOUND: ${path.join(projectRoot, 'missing')}`
    );
  });

  it('rejects a directory that contains no client artifacts', () => {
    fs.mkdirSync(path.join(projectRoot, 'empty'));

    expect(() => loadRscClientArtifacts('empty', projectRoot)).toThrow(
      `RSC_CLIENT_ARTIFACTS_REQUIRED: ${path.join(projectRoot, 'empty')}`
    );
  });

  it('identifies the client.json file that failed artifact validation', () => {
    const filename = path.join(projectRoot, 'artifacts', 'ios', 'client.json');
    writeArtifact(
      'artifacts/ios/client.json',
      new TextEncoder().encode('{not-json')
    );

    expect(() => loadRscClientArtifacts('artifacts', projectRoot)).toThrow(
      `RSC_CLIENT_ARTIFACT_INVALID: ${filename}: RSC_ARTIFACT_INVALID_JSON: client artifact`
    );
  });

  it('reports physical artifact filenames when the supplied directory is symlinked', () => {
    const physicalDirectory = path.join(projectRoot, 'physical');
    const linkedDirectory = path.join(projectRoot, 'linked');
    const filename = path.join(physicalDirectory, 'ios', 'client.json');
    writeArtifact(
      'physical/ios/client.json',
      new TextEncoder().encode('{not-json')
    );
    fs.symlinkSync(physicalDirectory, linkedDirectory, 'dir');

    expect(() => loadRscClientArtifacts('linked', projectRoot)).toThrow(
      `RSC_CLIENT_ARTIFACT_INVALID: ${filename}`
    );
  });

  function writeArtifact(relativePath: string, bytes: Uint8Array): void {
    const filename = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
  }
});

function createClientArtifact(platform: string) {
  return createRscClientArtifact({
    platform,
    platformManifest: {
      clientReferences: [],
      platform,
      runtimeVersion: '7',
      unit: 'widget',
    },
    roots: [],
    runtimeVersion: '7',
    serverFunctions: [],
    unit: 'widget',
  });
}
