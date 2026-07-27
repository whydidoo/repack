import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const repositoryRoot = path.resolve(packageRoot, '../..');
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'repack-rsc-clean-install-')
);

try {
  run(
    'pnpm',
    ['--filter', '@callstack/repack-plugin-rsc...', 'run', 'build'],
    repositoryRoot
  );

  const archiveRoot = path.join(temporaryDirectory, 'archives');
  const consumerRoot = path.join(temporaryDirectory, 'consumer');
  fs.mkdirSync(archiveRoot);
  fs.mkdirSync(consumerRoot);

  const pluginArchive = packWorkspacePackage(packageRoot, archiveRoot);
  assertNoStaleTypeScriptOutput(pluginArchive);
  const repackArchive = packWorkspacePackage(
    path.join(repositoryRoot, 'packages', 'repack'),
    archiveRoot
  );
  const devServerArchive = packWorkspacePackage(
    path.join(repositoryRoot, 'packages', 'dev-server'),
    archiveRoot
  );

  fs.writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'repack-rsc-clean-install-consumer',
        private: true,
        packageManager: 'pnpm@10.32.1',
        dependencies: {
          '@callstack/repack': `file:${repackArchive}`,
          '@callstack/repack-dev-server': `file:${devServerArchive}`,
          '@callstack/repack-plugin-rsc': `file:${pluginArchive}`,
          '@rspack/core': '1.6.0',
          '@swc/helpers': '0.5.18',
          react: '19.2.3',
          'react-dom': '19.2.6',
          'react-native': '0.84.1',
          'react-server-dom-webpack': '19.2.6',
          webpack: '5.105.3',
        },
      },
      null,
      2
    )}\n`
  );

  fs.writeFileSync(
    path.join(consumerRoot, 'pnpm-workspace.yaml'),
    `packages:\n  - '.'\n\npeerDependencyRules:\n  allowedVersions:\n    "react-dom@19.2.6>react": "19.2.3"\n    "react-server-dom-webpack@19.2.6>react": "19.2.3"\n`
  );

  run(
    'pnpm',
    [
      'install',
      '--ignore-scripts',
      '--strict-peer-dependencies',
      '--no-frozen-lockfile',
    ],
    consumerRoot
  );

  const requireFromConsumer = createRequire(
    path.join(consumerRoot, 'package-boundary-test.cjs')
  );
  for (const specifier of [
    '@callstack/repack-plugin-rsc',
    '@callstack/repack-plugin-rsc/client',
    '@callstack/repack-plugin-rsc/server',
    '@callstack/repack-plugin-rsc/runtime',
  ]) {
    requireFromConsumer.resolve(specifier);
  }

  fs.copyFileSync(
    path.join(packageRoot, 'scripts/fixtures/clean-install-smoke.mjs'),
    path.join(consumerRoot, 'packed-vertical-smoke.mjs')
  );
  run(process.execPath, ['./packed-vertical-smoke.mjs'], consumerRoot);

  process.stdout.write(
    'Clean RSC package install and vertical smoke passed.\n'
  );
} finally {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
}

function packWorkspacePackage(workspacePackageRoot, destination) {
  const before = new Set(fs.readdirSync(destination));
  run(
    'pnpm',
    ['pack', '--pack-destination', destination],
    workspacePackageRoot
  );
  const archiveName = fs
    .readdirSync(destination)
    .find((entry) => !before.has(entry) && entry.endsWith('.tgz'));
  if (!archiveName) {
    throw new Error(`Expected pnpm pack to archive ${workspacePackageRoot}`);
  }
  return path.join(destination, archiveName);
}

function assertNoStaleTypeScriptOutput(archivePath) {
  const archiveEntries = execFileSync('tar', ['-tzf', archivePath], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const staleOutput = archiveEntries.filter((entry) => {
    const relativeOutputPath = entry.replace(/^package\//, '');
    if (!relativeOutputPath.startsWith('dist/')) {
      return false;
    }

    const outputExtension = ['.d.ts', '.js'].find((extension) =>
      relativeOutputPath.endsWith(extension)
    );
    if (!outputExtension) {
      return false;
    }

    const sourceStem = relativeOutputPath
      .slice('dist/'.length, -outputExtension.length)
      .replaceAll('/', path.sep);
    return !['.ts', '.tsx', '.mts', '.cts'].some((extension) =>
      fs.existsSync(path.join(packageRoot, 'src', `${sourceStem}${extension}`))
    );
  });

  if (staleOutput.length > 0) {
    throw new Error(
      `Packed RSC package contains build output without source:\n${staleOutput.join(
        '\n'
      )}`
    );
  }
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  });
}
