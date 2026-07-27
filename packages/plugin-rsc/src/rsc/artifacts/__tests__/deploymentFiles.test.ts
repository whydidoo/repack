import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRscClientArtifactSet } from '../clientArtifactSet.js';
import { emitRscDeployment } from '../deploymentFiles.js';
import {
  createRscClientArtifact,
  parseRscDeploymentManifest,
  parseRscPlatformManifest,
} from '../index.js';

describe('emitRscDeployment', () => {
  let outputPath: string;

  beforeEach(() => {
    outputPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-deployment-'))
    );
    fs.writeFileSync(path.join(outputPath, 'server.js'), 'server');
  });

  afterEach(() => {
    fs.rmSync(outputPath, { force: true, recursive: true });
  });

  it('emits canonical platform, package and deployment files around the server entry', () => {
    const clientArtifact = createClientArtifact('ios');

    const deployment = emitRscDeployment({
      artifactSet: createRscClientArtifactSet([clientArtifact]),
      outputPath,
    });

    expect(fs.readFileSync(path.join(outputPath, 'package.json'), 'utf8')).toBe(
      '{"type":"module"}'
    );
    expect(
      parseRscPlatformManifest(
        fs.readFileSync(path.join(outputPath, 'manifests/ios.json'))
      )
    ).toEqual(clientArtifact.platformManifest);
    expect(Object.keys(deployment.artifacts)).toEqual([
      './manifests/ios.json',
      './package.json',
      './server.js',
    ]);
    expect(deployment.artifacts['./package.json']).toBe(
      'sha256:6dc1b06d6b093e9cccb20bee06a93836eee0420ae26803ca2ce4065d82f070d1'
    );
    expect(deployment.artifacts['./server.js']).toBe(
      'sha256:b3eacd33433b31b5252351032c9b3e7a2e7aa7738d5decdf0dd6c62680853c06'
    );
    expect(deployment.artifacts).not.toHaveProperty('./deployment.json');
    expect(
      parseRscDeploymentManifest(
        fs.readFileSync(path.join(outputPath, 'deployment.json'))
      )
    ).toEqual(deployment);
  });

  it('emits identical bytes for permuted artifacts and inventories nested regular files', () => {
    const otherOutputPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-deployment-'))
    );
    try {
      fs.writeFileSync(path.join(otherOutputPath, 'server.js'), 'server');
      for (const directory of [outputPath, otherOutputPath]) {
        fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(directory, 'assets/data.bin'), 'asset');
      }
      const ios = createClientArtifact('ios');
      const android = createClientArtifact('android');

      const first = emitRscDeployment({
        artifactSet: createRscClientArtifactSet([ios, android]),
        outputPath,
      });
      const second = emitRscDeployment({
        artifactSet: createRscClientArtifactSet([android, ios]),
        outputPath: otherOutputPath,
      });

      expect(first).toEqual(second);
      expect(Object.keys(first.artifacts)).toEqual([
        './assets/data.bin',
        './manifests/android.json',
        './manifests/ios.json',
        './package.json',
        './server.js',
      ]);
      expect(fs.readFileSync(path.join(outputPath, 'deployment.json'))).toEqual(
        fs.readFileSync(path.join(otherOutputPath, 'deployment.json'))
      );
    } finally {
      fs.rmSync(otherOutputPath, { force: true, recursive: true });
    }
  });

  it('rejects symlinks instead of following or omitting them from the inventory', () => {
    fs.symlinkSync(
      path.join(outputPath, 'server.js'),
      path.join(outputPath, 'server-link.js'),
      'file'
    );

    expect(() =>
      emitRscDeployment({
        artifactSet: createRscClientArtifactSet([createClientArtifact('ios')]),
        outputPath,
      })
    ).toThrow('RSC_ARTIFACT_INVALID_PATH: ./server-link.js');
  });

  it('rejects a deployment.json symlink before writing the final manifest', () => {
    const externalFile = path.join(
      path.dirname(outputPath),
      `${path.basename(outputPath)}-external.json`
    );
    fs.writeFileSync(externalFile, 'external');
    fs.symlinkSync(
      externalFile,
      path.join(outputPath, 'deployment.json'),
      'file'
    );

    expect(() =>
      emitRscDeployment({
        artifactSet: createRscClientArtifactSet([createClientArtifact('ios')]),
        outputPath,
      })
    ).toThrow('RSC_ARTIFACT_INVALID_PATH: ./deployment.json');
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('external');
    fs.rmSync(externalFile, { force: true });
  });

  it('rejects a manifests symlink before writing outside the output tree', () => {
    const externalDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'repack-rsc-external-')
    );
    fs.symlinkSync(
      externalDirectory,
      path.join(outputPath, 'manifests'),
      'dir'
    );

    expect(() =>
      emitRscDeployment({
        artifactSet: createRscClientArtifactSet([createClientArtifact('ios')]),
        outputPath,
      })
    ).toThrow('RSC_ARTIFACT_INVALID_PATH: ./manifests');
    expect(fs.readdirSync(externalDirectory)).toEqual([]);
    fs.rmSync(externalDirectory, { force: true, recursive: true });
  });

  it('rejects a symlinked output directory before writing through it', () => {
    const externalDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'repack-rsc-external-')
    );
    const linkedOutputPath = `${outputPath}-link`;
    fs.writeFileSync(path.join(externalDirectory, 'server.js'), 'server');
    fs.symlinkSync(externalDirectory, linkedOutputPath, 'dir');

    expect(() =>
      emitRscDeployment({
        artifactSet: createRscClientArtifactSet([createClientArtifact('ios')]),
        outputPath: linkedOutputPath,
      })
    ).toThrow('RSC_ARTIFACT_INVALID_PATH: .');
    expect(fs.readdirSync(externalDirectory)).toEqual(['server.js']);

    fs.rmSync(linkedOutputPath);
    fs.rmSync(externalDirectory, { force: true, recursive: true });
  });

  it('requires the compiled server entry before writing deployment metadata', () => {
    fs.rmSync(path.join(outputPath, 'server.js'));

    expect(() =>
      emitRscDeployment({
        artifactSet: createRscClientArtifactSet([createClientArtifact('ios')]),
        outputPath,
      })
    ).toThrow('RSC_ARTIFACT_INVALID_SCHEMA: entry:./server.js');
    expect(fs.existsSync(path.join(outputPath, 'package.json'))).toBe(false);
    expect(fs.existsSync(path.join(outputPath, 'manifests'))).toBe(false);
  });
});

function createClientArtifact(
  platform: string,
  coordinate: { readonly runtimeVersion: string; readonly unit: string } = {
    runtimeVersion: '7',
    unit: 'widget',
  }
) {
  return createRscClientArtifact({
    platform,
    platformManifest: {
      clientReferences: [],
      platform,
      runtimeVersion: coordinate.runtimeVersion,
      unit: coordinate.unit,
    },
    roots: [],
    runtimeVersion: coordinate.runtimeVersion,
    serverFunctions: [],
    unit: coordinate.unit,
  }).value;
}
