import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toNodeMiddleware } from '@callstack/repack-plugin-rsc/server';
import { rspack } from '@rspack/core';
import { encodeReply } from 'react-server-dom-webpack/client.node';

const require = createRequire(import.meta.url);
const consumerRoot = process.cwd();
const pluginEntry = require.resolve('@callstack/repack-plugin-rsc');
const repackEntry = require.resolve('@callstack/repack');
const devServerEntry = require.resolve('@callstack/repack-dev-server');

for (const entry of [pluginEntry, repackEntry, devServerEntry]) {
  assert.ok(
    entry.startsWith(consumerRoot),
    `Expected packed dependency to resolve inside the clean consumer: ${entry}`
  );
}

writeProjectFixture();
const configPath = path.join(consumerRoot, 'rspack.config.mjs');
const configModule = await import(pathToFileURL(configPath).href);
const clientConfig = await configModule.default({
  context: consumerRoot,
  mode: 'production',
  platform: 'ios',
});
await runCompiler(rspack(clientConfig), 'packed iOS client');

const clientArtifactPath = path.join(
  consumerRoot,
  'build/mobile/rsc/widget/7/ios/client.json'
);
const clientArtifact = JSON.parse(fs.readFileSync(clientArtifactPath, 'utf8'));
assert.deepEqual(
  {
    platform: clientArtifact.platform,
    protocolVersion: clientArtifact.protocolVersion,
    runtimeVersion: clientArtifact.runtimeVersion,
    unit: clientArtifact.unit,
  },
  { platform: 'ios', protocolVersion: 1, runtimeVersion: '7', unit: 'widget' }
);
assert.equal(clientArtifact.roots.length, 1);
assert.equal(clientArtifact.serverFunctions.length, 1);

const pluginRoot = path.dirname(path.dirname(pluginEntry));
const dependencyConfig = require(
  path.join(pluginRoot, 'react-native.config.js')
);
const rscBuildCommand = dependencyConfig.commands.find(
  (command) => command.name === 'rsc-build'
);
assert.ok(rscBuildCommand, 'Expected packed plugin to register rsc-build.');
const deploymentRoot = path.join(consumerRoot, 'build/deployment');
await rscBuildCommand.func(
  [],
  {
    platforms: ['ios'],
    reactNativePath: path.join(consumerRoot, 'fake-react-native'),
    root: consumerRoot,
  },
  {
    clientArtifacts: clientArtifactPath,
    config: configPath,
    output: deploymentRoot,
  }
);

const deploymentManifest = JSON.parse(
  fs.readFileSync(path.join(deploymentRoot, 'deployment.json'), 'utf8')
);
assert.deepEqual(
  {
    entry: deploymentManifest.entry,
    platforms: deploymentManifest.platforms,
    runtimeVersion: deploymentManifest.runtimeVersion,
    unit: deploymentManifest.unit,
  },
  {
    entry: './server.js',
    platforms: ['ios'],
    runtimeVersion: '7',
    unit: 'widget',
  }
);

const deployment = await import(
  pathToFileURL(path.join(deploymentRoot, 'server.js')).href
);
assert.equal(typeof deployment.default, 'function');
const nodeServer = http.createServer(toNodeMiddleware(deployment.default));
await listen(nodeServer);

try {
  const address = nodeServer.address();
  assert.ok(address && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}/rsc`;
  const rootId = clientArtifact.roots[0].id;
  const actionId = clientArtifact.serverFunctions[0].id;

  const renderResponse = await sendRscRequest(endpoint, {
    frame: { id: rootId, props: {} },
    kind: 'render',
    runtimeVersion: '7',
  });
  assert.equal(renderResponse.status, 200);
  assert.equal(renderResponse.headers.get('content-type'), 'text/x-component');
  assert.equal(renderResponse.headers.get('cache-control'), 'no-store');
  assert.ok(renderResponse.body, 'Expected streamed Node handler output.');
  assert.match(await readStream(renderResponse.body), /root:packed-consumer/);

  const actionResponse = await sendRscRequest(endpoint, {
    frame: { data: { token: 'packed-secret' }, id: actionId },
    kind: 'action',
    runtimeVersion: '7',
  });
  assert.equal(actionResponse.status, 200);
  assert.ok(actionResponse.body, 'Expected streamed Server Function output.');
  assert.match(
    await readStream(actionResponse.body),
    /action:packed-secret:packed-consumer/
  );

  const incompatibleResponse = await sendRscRequest(endpoint, {
    frame: { id: rootId, props: {} },
    kind: 'render',
    runtimeVersion: '6',
  });
  assert.equal(incompatibleResponse.status, 409);
  assert.equal(
    incompatibleResponse.headers.get('content-type'),
    'application/problem+json'
  );
  assert.deepEqual(await incompatibleResponse.json(), {
    code: 'RSC_INCOMPATIBLE',
    detail: 'RSC runtimeVersion is incompatible',
    expected: '7',
    reason: 'runtimeVersion',
    received: '6',
    status: 409,
    title: 'RSC compatibility error',
    type: 'about:blank',
  });
} finally {
  await close(nodeServer);
}

process.stdout.write('Packed RSC vertical smoke passed.\n');

function writeProjectFixture() {
  writeFile(
    'rspack.config.mjs',
    [
      "import path from 'node:path';",
      "import * as Repack from '@callstack/repack';",
      "import { RscPlugin } from '@callstack/repack-plugin-rsc';",
      '',
      'export default ({ context, mode, platform }) => ({',
      '  context,',
      "  entry: './index.js',",
      '  mode,',
      '  module: {',
      '    rules: [',
      "      { test: /\\.[cm]?[jt]sx?$/, type: 'javascript/auto' },",
      '    ],',
      '  },',
      '  name: platform,',
      '  optimization: { minimize: false },',
      '  output: {',
      "    filename: 'index.bundle',",
      "    path: path.join(context, 'build/mobile'),",
      "    uniqueName: 'packed-rsc-consumer',",
      '  },',
      '  plugins: [',
      '    new Repack.RepackPlugin({',
      "      initializeCore: path.join(context, 'fake-react-native/initialize.js'),",
      '      logger: false,',
      '      platform,',
      '    }),',
      '    new RscPlugin({',
      "      name: 'widget',",
      "      runtime: './src/rsc.runtime.js',",
      "      runtimeVersion: '7',",
      '      server: {',
      "        roots: ['./src'],",
      "        setup: './src/rsc.server.js',",
      '      },',
      '    }),',
      '  ],',
      '  resolve: {',
      '    ...Repack.getResolveOptions(platform, { enablePackageExports: true }),',
      "    alias: { 'react-native': path.join(context, 'fake-react-native') },",
      '  },',
      '});',
      '',
    ].join('\n')
  );
  writeFile(
    'index.js',
    [
      "export { Root } from './src/Root.js';",
      "export { checkMe } from './src/checkMe.js';",
      '',
    ].join('\n')
  );
  writeFile(
    'src/Root.js',
    [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      'export const Root = defineRscRoot(({ context }) =>',
      '  `root:${context.viewer}`',
      ');',
      '',
    ].join('\n')
  );
  writeFile(
    'src/checkMe.js',
    [
      "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
      'export const checkMe = createServerFn().handler(({ context, data }) =>',
      '  `action:${data.token}:${context.viewer}`',
      ');',
      '',
    ].join('\n')
  );
  writeFile(
    'src/rsc.runtime.js',
    [
      'export default {',
      '  createTransport() {',
      "    throw new Error('The build-only runtime must not execute in Node.');",
      '  },',
      '};',
      '',
    ].join('\n')
  );
  writeFile(
    'src/rsc.server.js',
    [
      "import { defineRscServer } from '@callstack/repack-plugin-rsc/server';",
      'export default defineRscServer({',
      '  createContext({ request }) {',
      "    return { viewer: request.headers.get('x-clean-consumer-viewer') };",
      '  },',
      '});',
      '',
    ].join('\n')
  );
  writeFile(
    'fake-react-native/package.json',
    JSON.stringify({ main: './index.js', name: 'react-native' })
  );
  writeFile(
    'fake-react-native/index.js',
    'exports.TurboModuleRegistry = { getEnforcing() { return {}; } };\n'
  );
  writeFile('fake-react-native/initialize.js', '');
  writeFile(
    'fake-react-native/rn-get-polyfills.js',
    'module.exports = () => [];\n'
  );
  writeFile(
    'fake-react-native/Libraries/Image/AssetRegistry.js',
    'module.exports = {};\n'
  );
  writeFile(
    'fake-react-native/Libraries/Image/AssetSourceResolver.js',
    'module.exports = {};\n'
  );
}

function writeFile(relativePath, contents) {
  const filename = path.join(consumerRoot, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
}

function runCompiler(compiler, label) {
  assert.ok(compiler, `Rspack did not create the ${label} compiler.`);
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) {
          reject(error ?? closeError);
          return;
        }
        if (!stats) {
          reject(new Error(`Rspack returned no stats for ${label}.`));
          return;
        }
        if (stats.hasErrors()) {
          reject(new Error(stats.toString('errors-only')));
          return;
        }
        resolve();
      });
    });
  });
}

async function sendRscRequest(endpoint, input) {
  const body = await encodeReply(input.frame);
  return fetch(endpoint, {
    body,
    headers: {
      accept: 'text/x-component',
      'x-clean-consumer-viewer': 'packed-consumer',
      'x-repack-rsc-kind': input.kind,
      'x-repack-rsc-platform': 'ios',
      'x-repack-rsc-protocol-version': '1',
      'x-repack-rsc-runtime-version': input.runtimeVersion,
      'x-repack-rsc-unit': 'widget',
    },
    method: 'POST',
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return output;
    }
    output += decoder.decode(value, { stream: true });
  }
}
