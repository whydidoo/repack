import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RepackPlugin } from '@callstack/repack';
import type { RscRspackPluginOptions } from '../../rsc/rspack/RscRspackPlugin.js';

const mockRscPluginSeams: {
  current?: Pick<
    RscRspackPluginOptions,
    'deploymentVerifier' | 'flightServer' | 'loader' | 'serverHandler'
  >;
} = {};

jest.mock('../../rsc/rspack/RscRspackPlugin.js', () => {
  const actual = jest.requireActual('../../rsc/rspack/RscRspackPlugin.js');
  return {
    ...actual,
    RscRspackPlugin: class extends actual.RscRspackPlugin {
      constructor(options: RscRspackPluginOptions) {
        super({ ...options, ...mockRscPluginSeams.current });
      }
    },
  };
});

import { RscPlugin } from '../../plugin.js';
import {
  createRscClientArtifact,
  parseRscDeploymentManifest,
} from '../../rsc/artifacts/index.js';
import { createRscContractId } from '../../rsc/compiler/contracts/index.js';
import { rscBuild } from '../rscBuild.js';

const PROJECT_CONFIG_KEY = '__REPACK_PLUGIN_RSC_BUILD_TEST_CONFIG__';

describe('rscBuild', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-plugin-rsc-build-'))
    );
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[PROJECT_CONFIG_KEY];
    mockRscPluginSeams.current = undefined;
    fs.rmSync(projectRoot, { force: true, recursive: true });
  });

  it('selects and builds the release unit matching the client artifacts', async () => {
    writeExecutableBuildFixture();

    const configPath = writeProjectConfig();
    writeClientArtifact('artifacts/ios/client.json');
    writeClientArtifact('artifacts/android/client.json', {
      platform: 'android',
    });

    await runBuild(configPath);

    const outputPath = path.join(projectRoot, 'build/rsc/widget/7');
    expect(listFiles(outputPath)).toEqual([
      'deployment.json',
      'manifests/android.json',
      'manifests/ios.json',
      'package.json',
      'server.js',
    ]);
    expect(
      parseRscDeploymentManifest(
        fs.readFileSync(path.join(outputPath, 'deployment.json'))
      )
    ).toMatchObject({
      entry: './server.js',
      platforms: ['android', 'ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });

    const result = runServer(path.join(outputPath, 'server.js'));
    if (result.status !== 0) {
      throw new Error(`RSC server startup failed: ${result.stderr}`);
    }
    expect(result.stdout).toBe('widget:7');
  });

  it('treats reordered source roots as the same release configuration', async () => {
    writeExecutableBuildFixture();
    writeFile('extra/catalog.js', 'export const catalog = true;');
    const configPath = writeProjectConfig((env) => [
      createWidgetPlugin(
        env.platform === 'android' ? ['./extra', './src'] : ['./src', './extra']
      ),
    ]);
    writeClientArtifact('artifacts/ios/client.json');
    writeClientArtifact('artifacts/android/client.json', {
      platform: 'android',
    });

    await expect(runBuild(configPath)).resolves.toBeUndefined();
  });

  it('treats symlink and physical source roots as the same release configuration', async () => {
    writeExecutableBuildFixture();
    fs.symlinkSync(
      path.join(projectRoot, 'src'),
      path.join(projectRoot, 'linked-src'),
      'dir'
    );
    const configPath = writeProjectConfig((env) => [
      createWidgetPlugin(
        env.platform === 'android' ? ['./linked-src', './src'] : ['./src']
      ),
    ]);
    writeClientArtifact('artifacts/ios/client.json');
    writeClientArtifact('artifacts/android/client.json', {
      platform: 'android',
    });

    await expect(runBuild(configPath)).resolves.toBeUndefined();
  });

  it('rejects overlapping source roots while discovering the release unit', async () => {
    writeFile('package.json', JSON.stringify({ name: 'rsc-build-fixture' }));
    writePeerManifest('react');
    writePeerManifest('react-server-dom-webpack');
    writeFile('src/rsc.runtime.js', 'export default {};');
    writeFile('src/rsc.server.js', 'export default {};');
    writeFile('src/nested/module.js', 'export const nested = true;');
    const configPath = writeProjectConfig(() => [
      createWidgetPlugin(['./src', './src/nested']),
    ]);
    writeClientArtifact('artifacts/ios/client.json');

    await expect(runBuild(configPath)).rejects.toThrow(
      'RSC_SOURCE_ROOT_OVERLAP'
    );
  });

  it('rejects a matching release unit that differs across artifact platforms', async () => {
    writeFile('package.json', JSON.stringify({ name: 'rsc-build-fixture' }));
    writePeerManifest('react');
    writePeerManifest('react-server-dom-webpack');
    writeFile('src/rsc.runtime.js', 'export default {};');
    writeFile('src/rsc.server.js', 'export default {};');
    writeFile('android-src/catalog.js', 'export const catalog = true;');

    const configPath = writeProjectConfig((env) => [
      new RscPlugin({
        name: 'widget',
        runtime: './src/rsc.runtime.js',
        runtimeVersion: '7',
        server: {
          roots: [env.platform === 'android' ? './android-src' : './src'],
          setup: './src/rsc.server.js',
        },
      }),
    ]);
    writeClientArtifact('artifacts/ios/client.json', { platform: 'ios' });
    writeClientArtifact('artifacts/android/client.json', {
      platform: 'android',
    });

    await expect(
      rscBuild(
        [],
        {
          platforms: ['ios', 'android'],
          reactNativePath: path.join(projectRoot, 'node_modules/react-native'),
          root: projectRoot,
        },
        {
          clientArtifacts: 'artifacts',
          config: configPath,
          output: 'build/rsc/widget/7',
        }
      )
    ).rejects.toThrow(
      'RscPlugin for widget@7 must resolve to the same configuration for every supplied client platform.'
    );
  });

  function createWidgetPlugin(roots: readonly string[]): RscPlugin {
    return new RscPlugin({
      name: 'widget',
      runtime: './src/rsc.runtime.js',
      runtimeVersion: '7',
      server: { roots, setup: './src/rsc.server.js' },
    });
  }

  function writeExecutableBuildFixture(): void {
    writeFile('package.json', JSON.stringify({ name: 'rsc-build-fixture' }));
    writePeerManifest('react');
    writePeerManifest('react-server-dom-webpack');
    writeFile('src/rsc.runtime.js', 'export default {};');
    writeFile('src/rsc.server.js', 'export default {};');
    writeFile('src/other.runtime.js', 'export default {};');
    writeFile('src/other.server.js', 'export default {};');
    writeFile(
      'src/Root.js',
      [
        "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
        "import { Button } from './Button';",
        'export const Root = defineRscRoot(() => Button());',
      ].join('\n')
    );
    writeFile(
      'src/Button.js',
      "'use client';\nexport function Button() { return null; }"
    );
    writeFile(
      'src/checkMe.js',
      [
        "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
        'export const checkMe = createServerFn().handler(() => true);',
      ].join('\n')
    );
    writeFile(
      'rsc-server-public-shim.js',
      [
        'export const defineRscRoot = (render) => render;',
        'export const createServerFn = () => ({ handler: (handler) => handler });',
      ].join('\n')
    );
    writeFile('rsc-loader-shim.cjs', 'module.exports = (source) => source;');
    writeFile(
      'rsc-handler-shim.js',
      [
        "export const createRscErrorDigest = () => 'digest';",
        'export const createRscHandler = (config) => async () =>',
        "  new Response(config.unit + ':' + config.runtimeVersion);",
      ].join('\n')
    );
    writeFile(
      'flight-server-shim.js',
      [
        'export const decodeReply = async () => ({});',
        'export const renderToReadableStream = () => new ReadableStream();',
      ].join('\n')
    );
    writeFile(
      'deployment-verifier-shim.js',
      'export const verifyRscDeploymentAtStartup = () => {};'
    );
    mockRscPluginSeams.current = {
      deploymentVerifier: path.join(projectRoot, 'deployment-verifier-shim.js'),
      flightServer: path.join(projectRoot, 'flight-server-shim.js'),
      loader: path.join(projectRoot, 'rsc-loader-shim.cjs'),
      serverHandler: path.join(projectRoot, 'rsc-handler-shim.js'),
    };
  }

  async function runBuild(configPath: string): Promise<void> {
    await rscBuild(
      [],
      {
        platforms: ['ios', 'android'],
        reactNativePath: path.join(projectRoot, 'node_modules/react-native'),
        root: projectRoot,
      },
      {
        clientArtifacts: 'artifacts',
        config: configPath,
        output: 'build/rsc/widget/7',
      }
    );
  }

  function writeProjectConfig(
    createRscPlugins: (env: {
      platform?: string;
    }) => readonly RscPlugin[] = () => [
      new RscPlugin({
        name: 'other',
        runtime: './src/other.runtime.js',
        runtimeVersion: '7',
        server: { roots: ['./src'], setup: './src/other.server.js' },
      }),
      new RscPlugin({
        name: 'widget',
        runtime: './src/rsc.runtime.js',
        runtimeVersion: '6',
        server: { roots: ['./src'], setup: './src/rsc.server.js' },
      }),
      new RscPlugin({
        name: 'widget',
        runtime: './src/rsc.runtime.js',
        runtimeVersion: '7',
        server: { roots: ['./src'], setup: './src/rsc.server.js' },
      }),
    ]
  ): string {
    const config = (env: { platform?: string }) => ({
      context: projectRoot,
      plugins: [
        new RepackPlugin({ platform: env.platform }),
        ...createRscPlugins(env),
      ],
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-public-shim.js'
          ),
        },
      },
      testPlatform: env.platform,
    });
    (globalThis as Record<string, unknown>)[PROJECT_CONFIG_KEY] = config;
    return writeFile(
      'rspack.config.cjs',
      `module.exports = globalThis[${JSON.stringify(PROJECT_CONFIG_KEY)}];`
    );
  }

  function writeClientArtifact(
    relativePath: string,
    coordinate: {
      readonly platform?: string;
      readonly runtimeVersion?: string;
      readonly unit?: string;
    } = {}
  ): void {
    const platform = coordinate.platform ?? 'ios';
    const runtimeVersion = coordinate.runtimeVersion ?? '7';
    const unit = coordinate.unit ?? 'widget';
    const identity = (exportName: string, sourcePath: string) => ({
      exportName,
      sourcePath,
    });
    const addressable = (
      kind: 'client-reference' | 'root' | 'server-function',
      exportName: string,
      sourcePath: string
    ) => ({
      id: createRscContractId({
        identity: identity(exportName, sourcePath),
        kind,
        mode: 'production',
        unit,
      }),
      identity: identity(exportName, sourcePath),
    });
    const button = addressable('client-reference', 'Button', 'Button.js');
    const artifact = createRscClientArtifact({
      platform,
      platformManifest: {
        clientReferences: [
          {
            ...button,
            target: {
              async: false,
              chunks: [],
              exportName: 'Button',
              moduleId: 42,
            },
          },
        ],
        platform,
        runtimeVersion,
        unit,
      },
      roots: [addressable('root', 'Root', 'Root.js')],
      runtimeVersion,
      serverFunctions: [
        addressable('server-function', 'checkMe', 'checkMe.js'),
      ],
      unit,
    });
    writeFile(relativePath, artifact.bytes);
  }

  function runServer(filename: string) {
    return spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "import { pathToFileURL } from 'node:url';",
          'const server = await import(pathToFileURL(process.argv[1]).href);',
          "const response = await server.handler(new Request('https://example.test/rsc'));",
          'process.stdout.write(await response.text());',
        ].join('\n'),
        filename,
      ],
      { encoding: 'utf8' }
    );
  }

  function listFiles(directory: string, prefix = ''): string[] {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const relativePath = path.posix.join(prefix, entry.name);
        return entry.isDirectory()
          ? listFiles(path.join(directory, entry.name), relativePath)
          : [relativePath];
      })
      .sort();
  }

  function writePeerManifest(packageName: string): void {
    writeFile(
      `node_modules/${packageName}/package.json`,
      JSON.stringify({ name: packageName, version: '19.2.6' })
    );
  }

  function writeFile(
    relativePath: string,
    contents: string | Uint8Array
  ): string {
    const filename = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
    return filename;
  }
});
