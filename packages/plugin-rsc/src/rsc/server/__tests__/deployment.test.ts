import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createRscDeploymentManifest,
  createRscPlatformManifest,
} from '../../artifacts/index.js';
import { createSha256Inventory } from '../../artifacts/inventory.js';
import type { RscInventoryFile } from '../../artifacts/types.js';
import { verifyRscDeploymentAtStartup } from '../deployment.js';

const utf8 = new TextEncoder();

describe('verifyRscDeploymentAtStartup', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-deploy-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { force: true, recursive: true });
  });

  it('returns the verified deployment and platform manifests', () => {
    writeDeployment();

    const verified = verifyRscDeploymentAtStartup({
      directory,
      platforms: ['ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });

    expect(verified.deployment).toMatchObject({
      entry: './server.js',
      platforms: ['ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });
    expect(verified.platformManifests).toEqual([
      expect.objectContaining({
        platform: 'ios',
        runtimeVersion: '7',
        unit: 'widget',
      }),
    ]);
  });

  it.each([
    {
      expected: { platforms: ['ios'], runtimeVersion: '8', unit: 'widget' },
      label: 'runtimeVersion',
    },
    {
      expected: { platforms: ['android'], runtimeVersion: '7', unit: 'widget' },
      label: 'platforms',
    },
    {
      expected: { platforms: ['ios'], runtimeVersion: '7', unit: 'account' },
      label: 'unit',
    },
  ])('rejects an unexpected deployment $label', ({ expected }) => {
    writeDeployment();

    expect(() =>
      verifyRscDeploymentAtStartup({ directory, ...expected })
    ).toThrow('RSC_ARTIFACT_COORDINATE_MISMATCH');
  });

  it.each([
    {
      change: () => writeFile('server.js', utf8.encode('modified')),
      expected: 'RSC_INVENTORY_HASH_MISMATCH: ./server.js',
      label: 'modified file',
    },
    {
      change: () => fs.unlinkSync(path.join(directory, 'manifests/ios.json')),
      expected: 'RSC_INVENTORY_MISSING_FILE: ./manifests/ios.json',
      label: 'missing file',
    },
    {
      change: () => writeFile('unexpected.txt', utf8.encode('unexpected')),
      expected: 'RSC_INVENTORY_UNEXPECTED_FILE: ./unexpected.txt',
      label: 'unexpected file',
    },
  ])('rejects a $label', ({ change, expected }) => {
    writeDeployment();
    change();

    expect(() =>
      verifyRscDeploymentAtStartup({
        directory,
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow(expected);
  });

  it('rejects symlinks without following them', () => {
    writeDeployment();
    fs.symlinkSync(
      path.join(directory, 'server.js'),
      path.join(directory, 'linked-server.js')
    );

    expect(() =>
      verifyRscDeploymentAtStartup({
        directory,
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_ARTIFACT_INVALID_PATH: ./linked-server.js');
  });

  it('reports a symlink before parsing a malformed deployment manifest', () => {
    writeFile('deployment.json', utf8.encode('{'));
    writeFile('server.js', utf8.encode('server'));
    fs.symlinkSync(
      path.join(directory, 'server.js'),
      path.join(directory, 'linked-server.js')
    );

    expect(() =>
      verifyRscDeploymentAtStartup({
        directory,
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_ARTIFACT_INVALID_PATH: ./linked-server.js');
  });

  it('checks each platform manifest coordinate', () => {
    writeDeployment({ platformRuntimeVersion: '8' });

    expect(() =>
      verifyRscDeploymentAtStartup({
        directory,
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow(
      'RSC_ARTIFACT_COORDINATE_MISMATCH: expected widget@7/ios, received widget@8/ios'
    );
  });

  it('requires server.js to remain the deployment entry', () => {
    writeDeployment({ deploymentEntry: './manifests/ios.json' });

    expect(() =>
      verifyRscDeploymentAtStartup({
        directory,
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_ARTIFACT_INVALID_SCHEMA: entry:./manifests/ios.json');
  });

  it('reports a missing deployment manifest', () => {
    expect(() =>
      verifyRscDeploymentAtStartup({
        directory,
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_INVENTORY_MISSING_FILE: ./deployment.json');
  });

  it.each([
    {
      expected: 'RSC_INVENTORY_MISSING_FILE: .',
      prepare: () => fs.rmSync(directory, { recursive: true }),
      state: 'missing directory',
    },
    {
      expected: 'RSC_INVENTORY_MISSING_FILE: ./deployment.json',
      prepare: () => undefined,
      state: 'missing manifest',
    },
    {
      expected: 'RSC_ARTIFACT_INVALID_JSON: deployment manifest',
      prepare: () => writeFile('deployment.json', utf8.encode('{')),
      state: 'malformed manifest',
    },
  ])(
    'reports a $state before validating expected coordinate paths',
    ({ expected, prepare }) => {
      prepare();

      expect(() =>
        verifyRscDeploymentAtStartup({
          directory,
          platforms: ['ios'],
          runtimeVersion: '7',
          unit: '../widget',
        })
      ).toThrow(expected);
    }
  );

  function writeDeployment(
    options: {
      readonly deploymentEntry?: string;
      readonly platformRuntimeVersion?: string;
    } = {}
  ): void {
    const platformManifest = createRscPlatformManifest({
      clientReferences: [],
      platform: 'ios',
      runtimeVersion: options.platformRuntimeVersion ?? '7',
      unit: 'widget',
    });
    const files: RscInventoryFile[] = [
      {
        bytes: utf8.encode('export const handler = true;'),
        path: './server.js',
      },
      { bytes: platformManifest.bytes, path: './manifests/ios.json' },
    ];
    for (const file of files) {
      writeFile(file.path.slice(2), file.bytes);
    }
    const deployment = createRscDeploymentManifest({
      artifacts: createSha256Inventory(files),
      entry: options.deploymentEntry ?? './server.js',
      platforms: ['ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });
    writeFile('deployment.json', deployment.bytes);
  }

  function writeFile(relativePath: string, bytes: Uint8Array): void {
    const filename = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
  }
});
