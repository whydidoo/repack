import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plugins } from '@callstack/repack';
import { type Compiler, rspack } from '@rspack/core';
import { Volume, createFsFromVolume } from 'memfs';
import { createRscClientArtifactSet } from '../../artifacts/clientArtifactSet.js';
import {
  createRscClientArtifact,
  parseRscClientArtifact,
} from '../../artifacts/index.js';
import { createRscContractId } from '../../compiler/contracts/index.js';
import {
  type RscDevServerRoute,
  registerRscDevServerRoute,
} from '../../development/devServerRoutes.js';
import { RscRspackPlugin } from '../RscRspackPlugin.js';
import { RSC_SERVER_LAYER } from '../constants.js';

jest.mock('../../development/devServerRoutes.js', () => {
  const actual = jest.requireActual<
    typeof import('../../development/devServerRoutes.js')
  >('../../development/devServerRoutes.js');
  return {
    ...actual,
    registerRscDevServerRoute: jest.fn(actual.registerRscDevServerRoute),
  };
});
jest.mock('../../server/nodeAdapter.js', () => ({
  toNodeMiddleware: (handler: unknown) =>
    Object.assign(() => undefined, { webHandler: handler }),
}));

const mockRegisterDevServerRoute = jest.mocked(registerRscDevServerRoute);

describe('RscRspackPlugin', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-rspack-'))
    );
    writeFile(
      'index.js',
      [
        "import { sharedSingleton } from './shared-singleton.js';",
        "import './src/Button.js?application-variant';",
        'export const application = sharedSingleton;',
      ].join('\n')
    );
    writeFile(
      'shared-singleton.js',
      "export const sharedSingleton = 'REPACK_SHARED_SINGLETON';"
    );
    writeFile('src/rsc.runtime.js', 'export default { createTransport() {} };');
    writeFile('src/rsc.server.js', 'export default {};');
    writeFile(
      'src/Root.js',
      [
        "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
        'export const Root = defineRscRoot(() => null);',
      ].join('\n')
    );
    writeFile(
      'src/Button.js',
      [
        "'use client';",
        "import { sharedSingleton } from '../shared-singleton.js';",
        'export function Button() { return sharedSingleton; }',
      ].join('\n')
    );
    writeFile(
      'src/checkMe.js',
      [
        "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
        'export const checkMe = createServerFn().handler(() => true);',
      ].join('\n')
    );
    writeFile(
      'rsc-server-shim.js',
      [
        'export const defineRscRoot = (render) => render;',
        'export const createServerFn = () => ({ handler: (handler) => handler });',
      ].join('\n')
    );
    writeFile(
      'test-rsc-loader.js',
      [
        'module.exports = function(source) {',
        "  if (this.resourcePath.endsWith('/Root.js') && this._module?.layer !== 'repack-rsc-server') {",
        "    return \"import { createRscRootProxy } from 'repack:rsc/widget/client-runtime'; export const Root = createRscRootProxy({ exportName: 'Root', sourcePath: 'Root.js' });\";",
        '  }',
        '  return source;',
        '};',
      ].join('\n')
    );
    writeFile(
      'rsc-client-runtime-shim.js',
      'export const createRscClientRuntime = () => ({ createRscRootProxy: () => () => null });'
    );
    writeFile(
      'dev-server-location-shim.js',
      "export const getDevServerLocation = () => ({ origin: 'http://localhost:8081' });"
    );
    writeFile(
      'rsdw-client-shim.js',
      'export const createFromReadableStream = () => null; export const encodeReply = async () => "";'
    );
    writeFile(
      'rsc-server-handler-shim.js',
      "export const createRscErrorDigest = () => 'digest'; export const createRscHandler = () => async () => new Response('flight');"
    );
    writeFile(
      'application-js-loader.js',
      [
        'module.exports = function(source) {',
        "  if (this.resourcePath.includes('/node_modules/.cache/repack/rsc/')) {",
        "    throw new Error('Application JS loader received a compiler-generated RSC module.');",
        '  }',
        '  return source;',
        '};',
      ].join('\n')
    );
    writeFile(
      'fake-reactRefreshLoader.js',
      [
        'module.exports = function(source) {',
        "  return source + '\\n$ReactRefreshRuntime$.refresh();';",
        '};',
      ].join('\n')
    );
    writeFile(
      'deployment-verifier-shim.js',
      'export const verifyRscDeploymentAtStartup = () => {};'
    );
    writeFile(
      'rsdw-server-shim.js',
      'export const decodeReply = async () => ({}); export const renderToReadableStream = () => new ReadableStream();'
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  });

  it('builds a client parent that shares application modules and an executable server child', async () => {
    const compiler = rspack({
      context: projectRoot,
      devServer: {},
      entry: './index.js',
      mode: 'development',
      module: {
        rules: [
          {
            test: /\.[cm]?[jt]sx?$/,
            use: path.join(projectRoot, 'application-js-loader.js'),
          },
          {
            exclude: /node_modules/,
            test: /\.[cm]?[jt]sx?$/,
            use: path.join(projectRoot, 'fake-reactRefreshLoader.js'),
          },
        ],
      },
      output: {
        filename: 'index.bundle',
        path: path.join(projectRoot, 'dist'),
      },
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-shim.js'
          ),
          'react-server-dom-webpack/client': path.join(
            projectRoot,
            'rsdw-client-shim.js'
          ),
        },
      },
      plugins: [
        new RscRspackPlugin({
          clientRuntime: path.join(projectRoot, 'rsc-client-runtime-shim.js'),
          devServerLocation: path.join(
            projectRoot,
            'dev-server-location-shim.js'
          ),
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          flightServer: path.join(projectRoot, 'rsdw-server-shim.js'),
          serverHandler: path.join(projectRoot, 'rsc-server-handler-shim.js'),
          target: { kind: 'development', platform: 'ios' },
        }),
        new plugins.RepackTargetPlugin(),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    const route = mockRegisterDevServerRoute.mock.calls[0]![1];
    expect(route).toMatchObject({
      path: '/__repack/rsc/widget/ios',
      handler: expect.any(Function),
    });
    expect((await readRouteResponse(route)).status).toBe(503);
    expect(compiler.options.module.rules).toContainEqual(
      expect.objectContaining({
        issuerLayer: RSC_SERVER_LAYER,
        resolve: expect.objectContaining({
          conditionNames: expect.arrayContaining(['react-server']),
        }),
      })
    );
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = createFsFromVolume(new Volume());

    const stats = await runCompiler(compiler);
    const json = stats.toJson({ entrypoints: true, modules: true });

    expect(json.errors).toEqual([]);
    expect(Object.keys(json.entrypoints ?? {}).sort()).toEqual([
      'main',
      'widget:client:ios',
    ]);
    const layers = new Set(
      (json.modules ?? [])
        .map((module) => module.layer)
        .filter((layer): layer is string => typeof layer === 'string')
    );
    expect(layers).toEqual(new Set());

    const serverCompilation = stats.compilation.children[0];
    expect(serverCompilation).toBeDefined();
    const clientBundle = stats.compilation.getAsset(
      'rsc/widget/development/ios/client.bundle'
    );
    expect(clientBundle).toBeDefined();
    expect(clientBundle!.source.source().toString()).toContain(
      '.push([["widget:client:ios"]'
    );
    expect(clientBundle!.source.source().toString()).not.toContain(
      'webpackBootstrap'
    );
    const sharedSingletonFilename = path.join(
      projectRoot,
      'shared-singleton.js'
    );
    const sharedSingletonModules = [...stats.compilation.modules].filter(
      (module) =>
        (module as typeof module & { resource?: string }).resource ===
        sharedSingletonFilename
    );
    expect(sharedSingletonModules).toHaveLength(1);
    expect(clientBundle!.source.source().toString()).not.toContain(
      'REPACK_SHARED_SINGLETON'
    );
    const virtualModuleRoot = `${path.join(
      projectRoot,
      'node_modules',
      '.cache',
      'repack',
      'rsc',
      'widget',
      'development',
      'ios'
    )}${path.sep}`;
    const virtualModuleResources = [
      ...stats.compilation.modules,
      ...serverCompilation!.modules,
    ]
      .map(
        (module) => (module as typeof module & { resource?: string }).resource
      )
      .filter(
        (resource): resource is string =>
          typeof resource === 'string' &&
          resource.includes(
            `${path.sep}node_modules${path.sep}.cache${path.sep}repack${path.sep}rsc${path.sep}`
          )
      );
    expect(virtualModuleResources.length).toBeGreaterThan(0);
    expect(
      virtualModuleResources.every((resource) =>
        resource.startsWith(virtualModuleRoot)
      )
    ).toBe(true);
    expect([...serverCompilation!.entrypoints.keys()]).toEqual(['server']);
    expect(serverCompilation!.entries.get('server')?.options).toMatchObject({
      layer: RSC_SERVER_LAYER,
    });
    expect(
      stats.compilation.getAsset('rsc/widget/development/ios/server.cjs')
    ).toBeUndefined();
    expect(
      stats.compilation.getAsset('rsc/widget/7/ios/client.json')
    ).toBeUndefined();
    const rootFilename = path.join(projectRoot, 'src/Root.js');
    const rootLayers = [...stats.compilation.modules]
      .filter(
        (module) =>
          (module as typeof module & { resource?: string }).resource ===
          rootFilename
      )
      .map((module) => module.layer)
      .sort();
    expect(rootLayers).toEqual([undefined]);
    const buttonFilename = path.join(projectRoot, 'src/Button.js');
    const buttonLayers = [...stats.compilation.modules]
      .filter(
        (module) =>
          (module as typeof module & { resource?: string }).resource ===
          buttonFilename
      )
      .map((module) => module.layer);
    expect(buttonLayers).toEqual([undefined]);
    expect(
      [...stats.compilation.modules].some(
        (module) =>
          (module as typeof module & { resource?: string }).resource ===
          `${buttonFilename}?application-variant`
      )
    ).toBe(true);
    expect(
      [...stats.compilation.modules].some(
        (module) =>
          (module as typeof module & { resource?: string }).resource ===
          path.join(projectRoot, 'src/rsc.runtime.js')
      )
    ).toBe(false);
    await expect(
      readRouteResponse(route).then((value) => value.text)
    ).resolves.toBe('flight');

    await closeCompiler(compiler);
    expect((await readRouteResponse(route)).status).toBe(503);
  });

  it('unwraps a CommonJS setup default, publishes rebuilds and retains the last handler after an error', async () => {
    writeFile(
      'src/rsc.server.js',
      "module.exports = { default: { value: 'A' } };"
    );
    writeFile(
      'rsc-server-handler-shim.js',
      [
        "export const createRscErrorDigest = () => 'digest';",
        'export const createRscHandler = ({ server }) => async () => new Response(server.value);',
      ].join('\n')
    );
    const compiler = rspack({
      context: projectRoot,
      devServer: {},
      entry: './index.js',
      mode: 'development',
      output: { path: path.join(projectRoot, 'dist') },
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-shim.js'
          ),
          'react-server-dom-webpack/client': path.join(
            projectRoot,
            'rsdw-client-shim.js'
          ),
        },
      },
      plugins: [
        new RscRspackPlugin({
          clientRuntime: path.join(projectRoot, 'rsc-client-runtime-shim.js'),
          devServerLocation: path.join(
            projectRoot,
            'dev-server-location-shim.js'
          ),
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          flightServer: path.join(projectRoot, 'rsdw-server-shim.js'),
          serverHandler: path.join(projectRoot, 'rsc-server-handler-shim.js'),
          target: { kind: 'development', platform: 'ios' },
        }),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    const route = mockRegisterDevServerRoute.mock.calls[0]![1];
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = createFsFromVolume(new Volume());

    const builds = watchCompiler(compiler);
    try {
      const initialStats = await builds.next();
      expect(initialStats.hasErrors()).toBe(false);
      await expect(
        readRouteResponse(route).then((value) => value.text)
      ).resolves.toBe('A');

      writeFile('src/rsc.server.js', "export default { value: 'B' };");
      const successfulRebuild = builds.next();
      builds.invalidate();
      expect((await successfulRebuild).hasErrors()).toBe(false);
      await expect(
        readRouteResponse(route).then((value) => value.text)
      ).resolves.toBe('B');

      writeFile('src/rsc.server.js', 'export default { value: ;');
      const failedRebuild = builds.next();
      builds.invalidate();
      expect((await failedRebuild).hasErrors()).toBe(true);
      await expect(
        readRouteResponse(route).then((value) => value.text)
      ).resolves.toBe('B');

      writeFile('src/rsc.server.js', "export default { value: 'B' };");
      writeFile(
        'src/Root.js',
        [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          'export const RenamedRoot = defineRscRoot(() => null);',
        ].join('\n')
      );
      const incompatibleRebuild = builds.next();
      builds.invalidate();
      const incompatibleStats = await incompatibleRebuild;
      expect(incompatibleStats.hasErrors()).toBe(true);
      const diagnostics = incompatibleStats.toJson({ errors: true }).errors;
      expect(diagnostics?.map((error) => error.message).join('\n')).toContain(
        'RSC development contract for unit "widget" (ios) changed while the dev server is running.'
      );
      expect(diagnostics?.map((error) => error.message).join('\n')).toContain(
        'Restart the dev server to accept the new contract.'
      );
      await expect(
        readRouteResponse(route).then((value) => value.text)
      ).resolves.toBe('B');
    } finally {
      await builds.close();
    }
  });

  it.each(['ios', 'android'] as const)(
    'emits a verifiable %s client artifact bound to its compiled mobile graph',
    async (platform) => {
      const outputPath = path.join(projectRoot, `dist-${platform}`);
      const compiler = rspack({
        context: projectRoot,
        entry: './index.js',
        mode: 'production',
        output: {
          filename: 'index.bundle',
          path: outputPath,
        },
        resolve: {
          alias: {
            '@callstack/repack-plugin-rsc/server': path.join(
              projectRoot,
              'rsc-server-shim.js'
            ),
            'react-server-dom-webpack/client': path.join(
              projectRoot,
              'rsdw-client-shim.js'
            ),
          },
        },
        plugins: [
          new RscRspackPlugin({
            clientRuntime: path.join(projectRoot, 'rsc-client-runtime-shim.js'),
            config: {
              name: 'widget',
              runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
              runtimeVersion: '7',
              server: {
                roots: [path.join(projectRoot, 'src')],
                setup: path.join(projectRoot, 'src/rsc.server.js'),
              },
            },
            loader: path.join(projectRoot, 'test-rsc-loader.js'),
            target: { kind: 'mobile', platform },
          }),
        ],
      });
      if (!compiler) {
        throw new Error('Rspack did not create a compiler.');
      }
      const outputFileSystem = createFsFromVolume(new Volume());
      // @ts-expect-error memfs is compatible with Rspack's output filesystem.
      compiler.outputFileSystem = outputFileSystem;

      const stats = await runCompiler(compiler);

      expect(stats.toString('errors-only')).not.toContain(
        'Multiple assets emit different content to the same filename index.bundle'
      );
      expect(stats.hasErrors()).toBe(false);
      expect(
        stats.compilation.getAsset(`rsc/widget/7/${platform}/client.bundle`)
      ).toBeDefined();
      const artifactFilename = `rsc/widget/7/${platform}/client.json`;
      expect(stats.compilation.getAsset(artifactFilename)?.info).toMatchObject({
        immutable: true,
      });
      const bytes = outputFileSystem.readFileSync(
        path.join(outputPath, artifactFilename)
      ) as Buffer;
      const artifact = parseRscClientArtifact(bytes);
      expect(artifact).toMatchObject({
        platform,
        platformManifest: {
          platform,
          clientReferences: [
            {
              identity: {
                exportName: 'Button',
                sourcePath: 'Button.js',
              },
              target: {
                exportName: 'Button',
              },
            },
          ],
        },
        roots: [
          {
            identity: {
              exportName: 'Root',
              sourcePath: 'Root.js',
            },
          },
        ],
        runtimeVersion: '7',
        serverFunctions: [
          {
            identity: {
              exportName: 'checkMe',
              sourcePath: 'checkMe.js',
            },
          },
        ],
        unit: 'widget',
      });
      expect(artifact.roots[0]?.id).toEqual(expect.any(String));
      expect(artifact.roots[0]?.id).not.toBe('');
      expect(artifact.serverFunctions[0]?.id).toEqual(expect.any(String));
      expect(artifact.serverFunctions[0]?.id).not.toBe('');

      const buttonFilename = path.join(projectRoot, 'src/Button.js');
      const buttonModule = [...stats.compilation.modules].find(
        (module) =>
          (module as typeof module & { resource?: string }).resource ===
          buttonFilename
      );
      expect(buttonModule).toBeDefined();
      const moduleId = stats.compilation.chunkGraph.getModuleId(buttonModule!);
      expect(moduleId).not.toBeNull();
      const chunks = [];
      for (const chunk of stats.compilation.chunkGraph.getModuleChunksIterable(
        buttonModule!
      )) {
        if (chunk.id === null || chunk.id === undefined) {
          continue;
        }
        for (const file of chunk.files) {
          chunks.push({ file: `./${file}`, id: chunk.id });
        }
      }
      const [clientReference] = artifact.platformManifest.clientReferences;
      expect(clientReference?.id).toEqual(expect.any(String));
      expect(clientReference?.id).not.toBe('');
      expect(clientReference?.target).toMatchObject({
        async: stats.compilation.moduleGraph.isAsync(buttonModule!),
        moduleId,
      });
      expect(
        new Set(
          clientReference?.target.chunks.map((chunk) => JSON.stringify(chunk))
        )
      ).toEqual(new Set(chunks.map((chunk) => JSON.stringify(chunk))));

      const clientEntrypoint = stats.compilation.entrypoints.get(
        `widget:client:${platform}`
      );
      expect(clientEntrypoint).toBeDefined();
      const emittedClient = clientEntrypoint!
        .getFiles()
        .map((file) =>
          String(outputFileSystem.readFileSync(path.join(outputPath, file)))
        )
        .join('\n');
      expect(emittedClient).toContain(artifact.roots[0]!.id);
      expect(emittedClient).toContain(artifact.serverFunctions[0]!.id);

      const serialized = bytes.toString('utf8');
      expect(serialized).not.toContain(projectRoot);
      expect(serialized).not.toContain(outputPath);
      expect(serialized).not.toContain('\\');

      await closeCompiler(compiler);
    }
  );

  it('rejects overlapping source roots before compiler mutation', () => {
    const sourceRoot = path.join(projectRoot, 'src');
    const nestedRoot = path.join(sourceRoot, 'features');
    writeFile('src/features/Profile.js', 'export const Profile = 1;');

    expect(() =>
      rspack({
        context: projectRoot,
        entry: './index.js',
        mode: 'production',
        output: { path: path.join(projectRoot, 'dist') },
        plugins: [
          new RscRspackPlugin({
            config: {
              name: 'widget',
              runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
              runtimeVersion: '7',
              server: {
                roots: [nestedRoot, sourceRoot],
                setup: path.join(projectRoot, 'src/rsc.server.js'),
              },
            },
            loader: path.join(projectRoot, 'test-rsc-loader.js'),
            target: { kind: 'mobile', platform: 'ios' },
          }),
        ],
      })
    ).toThrow(
      'RSC_SOURCE_ROOT_OVERLAP: RSC source roots must not overlap because one physical source would receive multiple logical paths'
    );
  });

  it('does not emit a mobile client artifact from a failed production compilation', async () => {
    writeFile('index.js', 'export const application = ;');
    const outputPath = path.join(projectRoot, 'dist');
    const compiler = rspack({
      context: projectRoot,
      entry: './index.js',
      mode: 'production',
      output: { path: outputPath },
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-shim.js'
          ),
          'react-server-dom-webpack/client': path.join(
            projectRoot,
            'rsdw-client-shim.js'
          ),
        },
      },
      plugins: [
        new RscRspackPlugin({
          clientRuntime: path.join(projectRoot, 'rsc-client-runtime-shim.js'),
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          target: { kind: 'mobile', platform: 'ios' },
        }),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    const outputFileSystem = createFsFromVolume(new Volume());
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = outputFileSystem;

    const stats = await runCompiler(compiler);

    expect(stats.hasErrors()).toBe(true);
    expect(
      stats.compilation.getAsset('rsc/widget/7/ios/client.json')
    ).toBeUndefined();

    await closeCompiler(compiler);
  });

  it('does not emit a release client artifact from a development-mode mobile compilation', async () => {
    const compiler = rspack({
      context: projectRoot,
      entry: './index.js',
      mode: 'development',
      output: { path: path.join(projectRoot, 'dist') },
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-shim.js'
          ),
          'react-server-dom-webpack/client': path.join(
            projectRoot,
            'rsdw-client-shim.js'
          ),
        },
      },
      plugins: [
        new RscRspackPlugin({
          clientRuntime: path.join(projectRoot, 'rsc-client-runtime-shim.js'),
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          target: { kind: 'mobile', platform: 'ios' },
        }),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = createFsFromVolume(new Volume());

    const stats = await runCompiler(compiler);

    expect(stats.hasErrors()).toBe(false);
    expect(
      stats.compilation.getAsset('rsc/widget/7/ios/client.json')
    ).toBeUndefined();

    await closeCompiler(compiler);
  });

  it('rejects different artifact content under one coordinate in a production watch lifecycle', async () => {
    const outputPath = path.join(projectRoot, 'dist');
    const artifactFilename = 'rsc/widget/7/ios/client.json';
    let buildLabel = 'initial';
    const compiler = rspack({
      context: projectRoot,
      entry: './index.js',
      mode: 'production',
      output: {
        filename: ({ chunk }) => `${chunk?.name ?? 'bundle'}.${buildLabel}.js`,
        path: outputPath,
      },
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-shim.js'
          ),
          'react-server-dom-webpack/client': path.join(
            projectRoot,
            'rsdw-client-shim.js'
          ),
        },
      },
      plugins: [
        new RscRspackPlugin({
          clientRuntime: path.join(projectRoot, 'rsc-client-runtime-shim.js'),
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          target: { kind: 'mobile', platform: 'ios' },
        }),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    const outputFileSystem = createFsFromVolume(new Volume());
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = outputFileSystem;

    const builds = watchCompiler(compiler);
    try {
      const initialStats = await builds.next();
      expect(initialStats.hasErrors()).toBe(false);
      const firstBytes = outputFileSystem.readFileSync(
        path.join(outputPath, artifactFilename)
      ) as Buffer;

      buildLabel = 'changed';
      writeFile(
        'src/Button.js',
        "'use client';\nexport function Button() { return 'changed'; }"
      );
      const changedBuild = builds.next();
      builds.invalidate();
      const changedStats = await changedBuild;

      expect(changedStats.hasErrors()).toBe(true);
      const diagnostics = changedStats.toJson({ errors: true }).errors ?? [];
      const message = diagnostics.map((error) => error.message).join('\n');
      expect(message).toContain(
        'RSC client artifact coordinate "widget/7/ios" produced different content'
      );
      expect(message).toContain('Bump runtimeVersion');
      expect(
        changedStats.compilation.getAsset(artifactFilename)
      ).toBeUndefined();
      expect(
        outputFileSystem.readFileSync(path.join(outputPath, artifactFilename))
      ).toEqual(firstBytes);
    } finally {
      await builds.close();
    }
  });

  it('requires a compiler restart and runtimeVersion bump after a production contract change', async () => {
    const outputPath = path.join(projectRoot, 'dist');
    const artifactFilename = 'rsc/widget/7/ios/client.json';
    const compiler = rspack({
      context: projectRoot,
      entry: './index.js',
      mode: 'production',
      output: { path: outputPath },
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-shim.js'
          ),
          'react-server-dom-webpack/client': path.join(
            projectRoot,
            'rsdw-client-shim.js'
          ),
        },
      },
      plugins: [
        new RscRspackPlugin({
          clientRuntime: path.join(projectRoot, 'rsc-client-runtime-shim.js'),
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          target: { kind: 'mobile', platform: 'ios' },
        }),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    const outputFileSystem = createFsFromVolume(new Volume());
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = outputFileSystem;

    const builds = watchCompiler(compiler);
    try {
      const initialStats = await builds.next();
      expect(initialStats.hasErrors()).toBe(false);
      const firstBytes = outputFileSystem.readFileSync(
        path.join(outputPath, artifactFilename)
      ) as Buffer;

      writeFile(
        'src/Card.js',
        "'use client';\nexport function Card() { return null; }"
      );
      const changedBuild = builds.next();
      builds.invalidate();
      const changedStats = await changedBuild;

      expect(changedStats.hasErrors()).toBe(true);
      const diagnostics = changedStats.toJson({ errors: true }).errors ?? [];
      const message = diagnostics.map((error) => error.message).join('\n');
      expect(message).toContain(
        'RSC production contract for unit "widget" (ios) changed'
      );
      expect(message).toContain('Restart the compiler');
      expect(message).toContain('runtimeVersion');
      expect(
        changedStats.compilation.getAsset(artifactFilename)
      ).toBeUndefined();
      expect(
        outputFileSystem.readFileSync(path.join(outputPath, artifactFilename))
      ).toEqual(firstBytes);
    } finally {
      await builds.close();
    }
  });

  it('composes the production server runtime from supplied client artifacts', async () => {
    const artifact = createRscClientArtifact({
      platform: 'ios',
      platformManifest: {
        clientReferences: [
          {
            id: createRscContractId({
              identity: { exportName: 'Button', sourcePath: 'Button.js' },
              kind: 'client-reference',
              mode: 'production',
              unit: 'widget',
            }),
            identity: { exportName: 'Button', sourcePath: 'Button.js' },
            target: {
              async: false,
              chunks: [],
              exportName: 'Button',
              moduleId: 42,
            },
          },
        ],
        platform: 'ios',
        runtimeVersion: '7',
        unit: 'widget',
      },
      roots: [],
      runtimeVersion: '7',
      serverFunctions: [],
      unit: 'widget',
    }).value;
    const compiler = rspack({
      context: projectRoot,
      devServer: {},
      entry: {},
      mode: 'development',
      output: { path: path.join(projectRoot, 'dist') },
      resolve: {
        alias: {
          '@callstack/repack-plugin-rsc/server': path.join(
            projectRoot,
            'rsc-server-shim.js'
          ),
        },
      },
      plugins: [
        new RscRspackPlugin({
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          deploymentVerifier: path.join(
            projectRoot,
            'deployment-verifier-shim.js'
          ),
          flightServer: path.join(projectRoot, 'rsdw-server-shim.js'),
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          serverHandler: path.join(projectRoot, 'rsc-server-handler-shim.js'),
          target: {
            artifactSet: createRscClientArtifactSet([artifact]),
            kind: 'server',
          },
        }),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    expect(compiler.options.output).toMatchObject({
      chunkFormat: 'module',
      chunkLoading: false,
      filename: 'server.js',
      library: { type: 'module' },
      module: true,
    });
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = createFsFromVolume(new Volume());

    const stats = await runCompiler(compiler);

    expect(stats.hasErrors()).toBe(false);
    const serverRuntime = [...stats.compilation.modules].find((module) =>
      (module as typeof module & { resource?: string }).resource?.endsWith(
        '/server-runtime.repack-rsc'
      )
    );
    expect(String(serverRuntime?.originalSource()?.source())).toContain(
      'Root.js'
    );
    const platformResolver = [...stats.compilation.modules].find((module) =>
      (module as typeof module & { resource?: string }).resource?.endsWith(
        '/client-reference-resolver.ios.repack-rsc'
      )
    );
    expect(String(platformResolver?.originalSource()?.source())).toContain(
      '"platform":"ios"'
    );

    await closeCompiler(compiler);
  });

  it('keeps the development route ready for source-located contract-index failures', async () => {
    writeFile(
      'src/legacy.js',
      [
        '// Explicit aliases are required for stable identities.',
        "export * from './Button';",
      ].join('\n')
    );
    const compiler = rspack({
      context: projectRoot,
      devServer: {},
      entry: './index.js',
      mode: 'development',
      output: { path: path.join(projectRoot, 'dist') },
      plugins: [
        new RscRspackPlugin({
          config: {
            name: 'widget',
            runtime: path.join(projectRoot, 'src/rsc.runtime.js'),
            runtimeVersion: '7',
            server: {
              roots: [path.join(projectRoot, 'src')],
              setup: path.join(projectRoot, 'src/rsc.server.js'),
            },
          },
          loader: path.join(projectRoot, 'test-rsc-loader.js'),
          target: { kind: 'development', platform: 'ios' },
        }),
      ],
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    const route = mockRegisterDevServerRoute.mock.calls[0]?.[1];
    expect(route).toMatchObject({
      path: '/__repack/rsc/widget/ios',
      handler: expect.any(Function),
    });
    if (!route) {
      throw new Error('RSC development route was not registered.');
    }
    const response = await readRouteResponse(route);
    expect(response).toMatchObject({
      cacheControl: 'no-store',
      contentType: 'application/problem+json',
      status: 503,
    });
    expect(JSON.parse(response.text)).toMatchObject({
      code: 'RSC_DEVELOPMENT_NOT_READY',
      status: 503,
    });
    // @ts-expect-error memfs is compatible with Rspack's output filesystem.
    compiler.outputFileSystem = createFsFromVolume(new Volume());

    const stats = await runCompiler(compiler);
    const errors = stats.toJson({ errors: true }).errors ?? [];

    expect(stats.compilation.children).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      file: path.join(projectRoot, 'src/legacy.js'),
    });
    expect(errors[0]?.message).toContain(
      "RSC contracts cannot be re-exported with export * from './Button'."
    );
    expect(errors[0]?.message).toContain(
      'Use static named re-exports instead.'
    );
    expect(errors[0]?.loc).toContain('2:0');

    await closeCompiler(compiler);
  });

  function writeFile(relativePath: string, source: string): void {
    const filename = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
  }
});

function runCompiler(
  compiler: Compiler
): Promise<NonNullable<Parameters<Parameters<Compiler['run']>[0]>[1]>> {
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) {
        reject(error);
      } else if (!stats) {
        reject(new Error('Rspack did not return stats.'));
      } else {
        resolve(stats);
      }
    });
  });
}

function closeCompiler(compiler: Compiler): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.close((error) => (error ? reject(error) : resolve()));
  });
}

type CompilerStats = NonNullable<Parameters<Parameters<Compiler['run']>[0]>[1]>;

function watchCompiler(compiler: Compiler): {
  close(): Promise<void>;
  invalidate(): void;
  next(): Promise<CompilerStats>;
} {
  const results: Array<
    { readonly error: Error } | { readonly stats: CompilerStats }
  > = [];
  const waiters: Array<(result: (typeof results)[number]) => void> = [];
  const watching = compiler.watch({ poll: 1_000 }, (error, stats) => {
    const result = error
      ? { error }
      : stats
        ? { stats }
        : { error: new Error('Rspack did not return watch stats.') };
    const waiter = waiters.shift();
    if (waiter) {
      waiter(result);
    } else {
      results.push(result);
    }
  });

  return {
    close: () =>
      new Promise((resolve) => {
        watching.close(resolve);
      }),
    invalidate: () => watching.invalidate(),
    next: () =>
      new Promise((resolve, reject) => {
        const consume = (result: (typeof results)[number]): void => {
          if ('error' in result) {
            reject(result.error);
          } else {
            resolve(result.stats);
          }
        };
        const result = results.shift();
        if (result) {
          consume(result);
        } else {
          waiters.push(consume);
        }
      }),
  };
}

async function readRouteResponse(route: RscDevServerRoute): Promise<{
  readonly cacheControl: string | null;
  readonly contentType: string | null;
  readonly status: number;
  readonly text: string;
}> {
  const webHandler = (
    route.handler as typeof route.handler & {
      readonly webHandler?: (request: Request) => Promise<Response>;
    }
  ).webHandler;
  if (!webHandler) {
    throw new Error(
      'Expected the test Node adapter to expose its Web handler.'
    );
  }
  const response = await webHandler(
    new Request(`http://localhost${route.path}`, { method: 'POST' })
  );
  return {
    cacheControl: response.headers.get('cache-control'),
    contentType: response.headers.get('content-type'),
    status: response.status,
    text: await response.text(),
  };
}
