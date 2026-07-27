import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getRscServerOutputLayout,
  planRscCompilation,
} from '../../compiler/plan/index.js';
import { verifyRscDeploymentAtStartup } from '../../server/deployment.js';
import { createRscClientArtifactSet } from '../clientArtifactSet.js';
import { emitRscDeployment } from '../deploymentFiles.js';
import { createRscClientArtifact } from '../index.js';

describe('RSC deployment artifact lifecycle', () => {
  it('composes a reverse-order two-platform plan through emission and URL-relative startup verification', () => {
    const outputPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-lifecycle-'))
    );
    try {
      const clientArtifacts = [
        createClientArtifact('ios'),
        createClientArtifact('android'),
      ];
      const artifactSet = createRscClientArtifactSet(clientArtifacts);
      const plan = planRscCompilation({
        config: {
          name: 'widget',
          runtime: '/does/not/exist/rsc.runtime.ts',
          runtimeVersion: '7',
          server: {
            roots: ['/does/not/exist/src'],
            setup: '/does/not/exist/rsc.server.ts',
          },
        },
        contractIndex: { clientEntries: [], contracts: [] },
        target: { artifactSet, kind: 'server' },
      });
      const outputLayout = getRscServerOutputLayout(plan);
      const serverFilename = path.join(outputPath, outputLayout.entry.path);
      fs.mkdirSync(path.dirname(serverFilename), { recursive: true });
      fs.writeFileSync(serverFilename, 'server');

      const emitted = emitRscDeployment({
        artifactSet,
        outputPath,
      });
      const plannedOutputPaths = [
        outputLayout.entry.path,
        outputLayout.deploymentManifest.path,
        outputLayout.packageManifest.path,
        ...outputLayout.platformManifests.map((output) => output.path),
      ];
      expect(new Set(plannedOutputPaths).size).toBe(plannedOutputPaths.length);
      expect(collectRelativeFiles(outputPath)).toEqual(
        [...plannedOutputPaths].sort()
      );
      expect(Object.keys(emitted.artifacts)).toEqual([
        './manifests/android.json',
        './manifests/ios.json',
        './package.json',
        './server.js',
      ]);
      const verified = verifyRscDeploymentAtStartup({
        directory: pathToFileURL(`${outputPath}${path.sep}`),
        platforms: plan.platforms,
        runtimeVersion: plan.runtimeVersion,
        unit: plan.unit,
      });

      expect(verified.deployment).toEqual(emitted);
      expect(
        verified.platformManifests.map((manifest) => manifest.platform)
      ).toEqual(['android', 'ios']);
    } finally {
      fs.rmSync(outputPath, { force: true, recursive: true });
    }
  });
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
  }).value;
}

function collectRelativeFiles(directory: string, root = directory): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory()
        ? collectRelativeFiles(filename, root)
        : [path.relative(root, filename).split(path.sep).join('/')];
    })
    .sort();
}
