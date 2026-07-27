import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RepackPlugin, plugins as RepackPlugins } from '@callstack/repack';
import { type Compiler, type Configuration, rspack } from '@rspack/core';
import { RscPlugin } from '../plugin.js';

describe('RscPlugin', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'repack-plugin-rsc-'))
    );
    writeFile('index.js', 'export const application = true;');
    writeFile('src/rsc.runtime.js', 'export default {};');
    writeFile('src/rsc.server.js', 'export default {};');
    writePackage('react', '19.2.6');
    writePackage('react-server-dom-webpack', '19.2.6');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  });

  it.each(['before', 'after'] as const)(
    'works when RepackPlugin is applied %s RscPlugin',
    async (repackPluginOrder) => {
      const compiler = createCompiler({
        devServer: {},
        mode: 'development',
        repackPluginOrder,
      });

      expect(compiler.options.experiments.layers).toBe(true);
      const middlewares = compiler.options.devServer?.setupMiddlewares?.(
        [],
        {} as never
      ) as Array<{ path?: string }>;
      expect(middlewares).toEqual([
        expect.objectContaining({ path: '/__repack/rsc/widget/ios' }),
      ]);

      await closeCompiler(compiler);
    }
  );

  it('rejects RscPlugin without the Re.Pack target setup', () => {
    expect(() =>
      createCompiler({
        mode: 'development',
        repackPluginOrder: undefined,
      })
    ).toThrow(
      'RscPlugin requires RepackPlugin (or the equivalent Re.Pack target plugins)'
    );
  });

  it('applies a production mobile graph without registering a route', async () => {
    const compiler = createCompiler({
      mode: 'production',
      repackPluginOrder: 'before',
    });

    expect(compiler.options.experiments.layers).toBe(true);
    expect(compiler.options.devServer?.setupMiddlewares).toBeUndefined();

    await closeCompiler(compiler);
  });

  it('allows an application-owned Feature Catalog share', async () => {
    const compiler = createCompiler({
      mode: 'production',
      repackPluginOrder: 'before',
      additionalPlugins: [
        new RepackPlugins.ModuleFederationPluginV1({
          name: 'host',
          shared: { '@app/feature-catalog': { singleton: true } },
        }),
      ],
    });

    await closeCompiler(compiler);
  });

  it.each(['rsc-first', 'federation-first'] as const)(
    'rejects protected Module Federation sharing with %s plugin order',
    (pluginOrder) => {
      const rscPlugin = new RscPlugin({
        name: 'widget',
        runtime: './src/rsc.runtime.js',
        runtimeVersion: '7',
        server: {
          roots: ['./src'],
          setup: './src/rsc.server.js',
        },
      });
      const federationPlugin = new RepackPlugins.ModuleFederationPluginV1({
        name: 'host',
        shared: {
          '@callstack/repack-plugin-rsc/client': { singleton: true },
        },
      });
      const integrationPlugins =
        pluginOrder === 'rsc-first'
          ? [rscPlugin, federationPlugin]
          : [federationPlugin, rscPlugin];

      expect(() =>
        rspack({
          context: projectRoot,
          entry: './index.js',
          mode: 'development',
          name: 'ios',
          output: { path: path.join(projectRoot, 'dist') },
          plugins: [new RepackPlugin({ logger: false }), ...integrationPlugins],
        })
      ).toThrow('@callstack/repack-plugin-rsc/client');
    }
  );

  it('rejects unsupported platforms before compilation', () => {
    expect(() =>
      createCompiler({
        mode: 'development',
        name: 'web',
        repackPluginOrder: 'before',
      })
    ).toThrow(
      'RscPlugin requires platform to be "android" or "ios", received: web'
    );
  });

  function createCompiler(input: {
    readonly additionalPlugins?: NonNullable<Configuration['plugins']>;
    readonly devServer?: Record<string, never>;
    readonly mode: 'development' | 'production';
    readonly name?: string;
    readonly repackPluginOrder: 'before' | 'after' | undefined;
  }): Compiler {
    const rscPlugin = new RscPlugin({
      name: 'widget',
      runtime: './src/rsc.runtime.js',
      runtimeVersion: '7',
      server: {
        roots: ['./src'],
        setup: './src/rsc.server.js',
      },
    });
    const repackPlugin = new RepackPlugin({ logger: false });
    const plugins =
      input.repackPluginOrder === 'before'
        ? [repackPlugin, rscPlugin, ...(input.additionalPlugins ?? [])]
        : input.repackPluginOrder === 'after'
          ? [rscPlugin, repackPlugin, ...(input.additionalPlugins ?? [])]
          : [rscPlugin, ...(input.additionalPlugins ?? [])];
    const compiler = rspack({
      context: projectRoot,
      devServer: input.devServer,
      entry: './index.js',
      mode: input.mode,
      name: input.name ?? 'ios',
      output: { path: path.join(projectRoot, 'dist') },
      plugins,
    });
    if (!compiler) {
      throw new Error('Rspack did not create a compiler.');
    }
    return compiler;
  }

  function writeFile(relativePath: string, contents: string): void {
    const filename = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  }

  function writePackage(name: string, version: string): void {
    writeFile(
      path.join('node_modules', name, 'package.json'),
      JSON.stringify({ name, version })
    );
  }
});

function closeCompiler(compiler: Compiler): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.close((error) => (error ? reject(error) : resolve()));
  });
}
