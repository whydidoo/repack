import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { getResolveOptions } from '@callstack/repack';
import { type Stats, rspack } from '@rspack/core';

const packageRoot = path.resolve(__dirname, '../../..');
const repositoryRoot = path.resolve(packageRoot, '../..');

describe('RSC package exports', () => {
  let temporaryDirectory: string;
  let extractedPackageRoot: string;
  let requireFromPackage: NodeJS.Require;

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'repack-rsc-package-')
    );

    execFileSync(
      'pnpm',
      ['--filter', '@callstack/repack-plugin-rsc...', 'run', 'build'],
      {
        cwd: repositoryRoot,
        stdio: 'pipe',
      }
    );
    execFileSync('pnpm', ['pack', '--pack-destination', temporaryDirectory], {
      cwd: packageRoot,
      stdio: 'pipe',
    });

    const archiveName = fs
      .readdirSync(temporaryDirectory)
      .find((entry) => entry.endsWith('.tgz'));

    if (!archiveName) {
      throw new Error('Expected pnpm pack to produce a package archive');
    }

    const extractedDirectory = path.join(temporaryDirectory, 'extracted');
    fs.mkdirSync(extractedDirectory);
    execFileSync(
      'tar',
      [
        '-xzf',
        path.join(temporaryDirectory, archiveName),
        '-C',
        extractedDirectory,
      ],
      { stdio: 'pipe' }
    );

    extractedPackageRoot = fs.realpathSync(
      path.join(extractedDirectory, 'package')
    );
    fs.symlinkSync(
      path.join(packageRoot, 'node_modules'),
      path.join(extractedPackageRoot, 'node_modules'),
      'dir'
    );
    requireFromPackage = createRequire(
      path.join(extractedPackageRoot, 'package-boundary-test.cjs')
    );
  }, 120_000);

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('resolves every public RSC subpath from the packed package', () => {
    const resolvedSubpaths = [
      '@callstack/repack-plugin-rsc',
      '@callstack/repack-plugin-rsc/client',
      '@callstack/repack-plugin-rsc/server',
      '@callstack/repack-plugin-rsc/runtime',
    ].map((specifier) =>
      path.relative(extractedPackageRoot, requireFromPackage.resolve(specifier))
    );

    expect(resolvedSubpaths).toEqual([
      'dist/index.js',
      'dist/rsc/client/index.js',
      'dist/rsc/server/index.js',
      'dist/rsc/runtime/index.js',
    ]);
  });

  it('bundles every RSC subpath with Re.Pack default resolve options', async () => {
    const consumerRoot = path.join(
      temporaryDirectory,
      'rspack-default-resolver-consumer'
    );
    const consumerPackageDirectory = path.join(
      consumerRoot,
      'node_modules',
      '@callstack'
    );
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.symlinkSync(
      fs.realpathSync(path.join(packageRoot, 'node_modules', 'react')),
      path.join(consumerRoot, 'node_modules', 'react'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.js'),
      `
import '@callstack/repack-plugin-rsc/client';
import '@callstack/repack-plugin-rsc/server';
import '@callstack/repack-plugin-rsc/runtime';
`
    );

    const stats = await new Promise<Stats>((resolve, reject) => {
      rspack(
        {
          context: consumerRoot,
          devtool: false,
          entry: './index.js',
          mode: 'development',
          output: {
            path: path.join(consumerRoot, 'dist'),
          },
          resolve: getResolveOptions('ios'),
          target: 'node',
        },
        (error, compilationStats) => {
          if (error) {
            reject(error);
          } else if (!compilationStats) {
            reject(new Error('Rspack did not return compilation stats'));
          } else {
            resolve(compilationStats);
          }
        }
      );
    });

    expect(stats.toString({ all: false, errors: true })).toBe('');
  });

  it('keeps the client subpath free of Node-only plugin dependencies', async () => {
    expect(
      requireFromPackage('@callstack/repack-plugin-rsc/client')
        .isRscCompatibilityError
    ).toEqual(expect.any(Function));

    const consumerRoot = path.join(
      temporaryDirectory,
      'rspack-native-client-consumer'
    );
    const consumerPackageDirectory = path.join(
      consumerRoot,
      'node_modules',
      '@callstack'
    );
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.js'),
      `
import { isRscCompatibilityError } from '@callstack/repack-plugin-rsc/client';
export const check = isRscCompatibilityError;
`
    );

    const stats = await new Promise<Stats>((resolve, reject) => {
      rspack(
        {
          context: consumerRoot,
          devtool: false,
          entry: './index.js',
          mode: 'development',
          output: {
            chunkFormat: 'array-push',
            globalObject: 'self',
            path: path.join(consumerRoot, 'dist'),
          },
          resolve: getResolveOptions('ios'),
          target: false,
        },
        (error, compilationStats) => {
          if (error) {
            reject(error);
          } else if (!compilationStats) {
            reject(new Error('Rspack did not return compilation stats'));
          } else {
            resolve(compilationStats);
          }
        }
      );
    });

    expect(stats.toString({ all: false, errors: true })).toBe('');
  });

  it('ships declarations for every public RSC subpath', () => {
    const declarationPaths = [
      'dist/index.d.ts',
      'dist/rsc/client/index.d.ts',
      'dist/rsc/server/index.d.ts',
      'dist/rsc/runtime/index.d.ts',
    ];

    expect(
      declarationPaths.filter(
        (declarationPath) =>
          !fs.existsSync(path.join(extractedPackageRoot, declarationPath))
      )
    ).toEqual([]);
  });

  it('does not ship wrapper directories for public RSC subpaths', () => {
    expect(
      ['client', 'server', 'runtime'].filter((directory) =>
        fs.existsSync(path.join(extractedPackageRoot, directory))
      )
    ).toEqual([]);
  });

  it('publishes the supported React and RSDW versions as required peers', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(extractedPackageRoot, 'package.json'), 'utf8')
    );

    expect({
      swcHelpers: manifest.dependencies['@swc/helpers'],
      react: manifest.peerDependencies.react,
      rsdw: manifest.peerDependencies['react-server-dom-webpack'],
      optionalPeers: manifest.peerDependenciesMeta,
    }).toEqual({
      swcHelpers: '~0.5.17',
      react: '>=19.2.3 <19.3.0',
      rsdw: '>=19.2.6 <19.3.0',
      optionalPeers: undefined,
    });
  });

  it('does not expose RSC implementation files outside public subpaths', () => {
    expect(() =>
      requireFromPackage.resolve(
        '@callstack/repack-plugin-rsc/dist/rsc/index.js'
      )
    ).toThrow();
  });

  it('loads the default entry without executing RSDW runtime code', () => {
    const testScriptPath = path.join(
      extractedPackageRoot,
      'default-entry-boundary-test.cjs'
    );

    fs.writeFileSync(
      testScriptPath,
      `
require('@callstack/repack-plugin-rsc');

const loadedRsdwModules = Object.keys(require.cache).filter((modulePath) =>
  modulePath.includes('/react-server-dom-webpack/')
);

if (loadedRsdwModules.length > 0) {
  throw new Error(\`Default entry loaded RSDW modules: \${loadedRsdwModules}\`);
}
`
    );

    expect(() =>
      execFileSync(process.execPath, [testScriptPath], {
        cwd: extractedPackageRoot,
        env: {
          ...process.env,
          NODE_PATH: path.join(packageRoot, 'node_modules'),
        },
        stdio: 'pipe',
      })
    ).not.toThrow();
  });

  it('typechecks public RSC configuration without bundler types', () => {
    const consumerRoot = path.join(temporaryDirectory, 'rsc-type-consumer');
    const consumerPackageDirectory = path.join(
      consumerRoot,
      'node_modules',
      '@callstack'
    );
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.ts'),
      `
import type {
  RscClientArtifact,
  RscDeploymentManifest,
  RscPlatformManifest,
  RscPluginConfig,
} from '@callstack/repack-plugin-rsc';
import type { RscHandler } from '@callstack/repack-plugin-rsc/server';
import { toNodeMiddleware } from '@callstack/repack-plugin-rsc/server';

const config = {
  name: 'widget',
  runtimeVersion: '7',
  runtime: './src/rsc.runtime.ts',
  server: {
    roots: ['./src'],
    setup: './src/rsc.server.ts',
  },
} satisfies RscPluginConfig;

void config;

declare const clientArtifact: RscClientArtifact;
declare const platformManifest: RscPlatformManifest;
declare const deploymentManifest: RscDeploymentManifest;

void clientArtifact;
void platformManifest;
void deploymentManifest;

declare const handler: RscHandler;
const response: Promise<Response> = handler(new Request('https://rsc.test'));
const middleware = toNodeMiddleware(handler, {
  resolveOrigin(request) {
    const trustedOrigin = request.headers['x-trusted-origin'];
    return typeof trustedOrigin === 'string'
      ? trustedOrigin
      : 'https://rsc.test';
  },
});
void response;
void middleware;
`
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          noEmit: true,
          strict: true,
          target: 'ES2022',
          types: [],
        },
        files: ['./index.ts'],
      })
    );

    expect(() =>
      execFileSync(
        path.join(packageRoot, 'node_modules', '.bin', 'tsc'),
        ['--project', path.join(consumerRoot, 'tsconfig.json')],
        {
          cwd: consumerRoot,
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });

  it('typechecks an application-owned RSC transport without bundler types', () => {
    const consumerRoot = path.join(
      temporaryDirectory,
      'rsc-runtime-type-consumer'
    );
    const consumerPackageDirectory = path.join(
      consumerRoot,
      'node_modules',
      '@callstack'
    );
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.ts'),
      `
import type { RscRuntimeConfig } from '@callstack/repack-plugin-rsc/runtime';

const runtime = {
  async createTransport(context) {
    const unit: string = context.unit;
    const runtimeVersion: string = context.runtimeVersion;
    const platform: string = context.platform;
    const development: boolean = context.development;

    return {
      async fetch(request) {
        const kind: 'render' | 'action' = request.kind;
        const init: RequestInit = request.init;

        void unit;
        void runtimeVersion;
        void platform;
        void development;
        void kind;
        void init;

        return new Response();
      },
      dispose() {},
    };
  },
} satisfies RscRuntimeConfig;

void runtime;
`
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          noEmit: true,
          strict: true,
          target: 'ES2022',
          types: [],
        },
        files: ['./index.ts'],
      })
    );

    expect(() =>
      execFileSync(
        path.join(packageRoot, 'node_modules', '.bin', 'tsc'),
        ['--project', path.join(consumerRoot, 'tsconfig.json')],
        {
          cwd: consumerRoot,
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });

  it('typechecks useRscRefresh without exposing a root ID', () => {
    const consumerRoot = path.join(
      temporaryDirectory,
      'rsc-client-type-consumer'
    );
    const consumerPackageDirectory = path.join(
      consumerRoot,
      'node_modules',
      '@callstack'
    );
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.symlinkSync(
      fs.realpathSync(path.join(packageRoot, 'node_modules', 'react')),
      path.join(consumerRoot, 'node_modules', 'react'),
      'dir'
    );
    const consumerTypesDirectory = path.join(
      consumerRoot,
      'node_modules',
      '@types'
    );
    fs.mkdirSync(consumerTypesDirectory);
    fs.symlinkSync(
      fs.realpathSync(path.join(packageRoot, 'node_modules', '@types/react')),
      path.join(consumerTypesDirectory, 'react'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.ts'),
      `
import { useRscRefresh } from '@callstack/repack-plugin-rsc/client';

const refresh: () => Promise<void> = useRscRefresh();
void refresh();

// @ts-expect-error root identity remains private to the generated runtime.
useRscRefresh('root-id');
`
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          noEmit: true,
          strict: true,
          target: 'ES2022',
          types: [],
        },
        files: ['./index.ts'],
      })
    );

    expect(() =>
      execFileSync(
        path.join(packageRoot, 'node_modules', '.bin', 'tsc'),
        ['--project', path.join(consumerRoot, 'tsconfig.json')],
        {
          cwd: consumerRoot,
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });

  it('typechecks declaration-owned request identity for RSC root props', () => {
    const consumerRoot = path.join(
      temporaryDirectory,
      'rsc-root-props-type-consumer'
    );
    const consumerNodeModules = path.join(consumerRoot, 'node_modules');
    const consumerPackageDirectory = path.join(
      consumerNodeModules,
      '@callstack'
    );
    const consumerTypesDirectory = path.join(consumerNodeModules, '@types');
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.mkdirSync(consumerTypesDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.symlinkSync(
      path.join(packageRoot, 'node_modules', 'react'),
      path.join(consumerNodeModules, 'react'),
      'dir'
    );
    fs.symlinkSync(
      path.join(packageRoot, 'node_modules', '@types', 'react'),
      path.join(consumerTypesDirectory, 'react'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.ts'),
      `
import { createElement } from 'react';
import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';
import type { RscStandardSchemaV1 } from '@callstack/repack-plugin-rsc/server';

const schema: RscStandardSchemaV1<unknown, { teamId: string }> = {
  '~standard': {
    validate: () => ({ value: { teamId: 'callstack' } }),
    vendor: 'test',
    version: 1,
  },
};

const Team = defineRscRoot({
  pending: 'fallback',
  props: schema,
  reloadOn: ['teamId'],
  render: ({ props }) => props.teamId,
});
const Home = defineRscRoot(() => null);

createElement(Team, { teamId: 'callstack' });
createElement(Home);

// @ts-expect-error roots with props require declaration-owned identity fields.
defineRscRoot({ props: schema, render: () => null });

// @ts-expect-error reloadOn only accepts schema output field names.
defineRscRoot({ props: schema, reloadOn: ['missing'], render: () => null });

const objectSchema: RscStandardSchemaV1<unknown, { filters: { active: boolean } }> = {
  '~standard': {
    validate: () => ({ value: { filters: { active: true } } }),
    vendor: 'test',
    version: 1,
  },
};

// @ts-expect-error object-valued fields cannot define request identity.
defineRscRoot({ props: objectSchema, reloadOn: ['filters'], render: () => null });

`
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          noEmit: true,
          preserveSymlinks: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
        files: ['./index.ts'],
      })
    );

    expect(() =>
      execFileSync(
        path.join(packageRoot, 'node_modules', '.bin', 'tsc'),
        ['--project', path.join(consumerRoot, 'tsconfig.json')],
        {
          cwd: consumerRoot,
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });

  it('typechecks Server Function input, context, and result from the public subpath', () => {
    const consumerRoot = path.join(
      temporaryDirectory,
      'rsc-server-function-type-consumer'
    );
    const consumerNodeModules = path.join(consumerRoot, 'node_modules');
    const consumerPackageDirectory = path.join(
      consumerNodeModules,
      '@callstack'
    );
    const consumerTypesDirectory = path.join(consumerNodeModules, '@types');
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.mkdirSync(consumerTypesDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.symlinkSync(
      path.join(packageRoot, 'node_modules', 'react'),
      path.join(consumerNodeModules, 'react'),
      'dir'
    );
    fs.symlinkSync(
      path.join(packageRoot, 'node_modules', '@types', 'react'),
      path.join(consumerTypesDirectory, 'react'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.ts'),
      `
import {
  createMiddleware,
  createServerFn,
  defineRscServer,
} from '@callstack/repack-plugin-rsc/server';
import type { RscStandardSchemaV1 } from '@callstack/repack-plugin-rsc/server';

const viewer = createMiddleware().server(({ next }) =>
  next({ context: { viewerId: 'viewer' } })
);
const server = defineRscServer({
  createContext: () => ({ requestId: 'request' }),
  middleware: [viewer],
});
const bareServer = defineRscServer({
  createContext: () => ({ tenantId: 'tenant' }),
});
type BareContext = NonNullable<typeof bareServer['~types']>['context'];
const bareContext: BareContext = { tenantId: 'tenant' };

const logger = createMiddleware<{ requestId: string }>().server(
  ({ context, next }) => {
    const requestId: string = context.requestId;
    void requestId;
    return next();
  }
);

declare module '@callstack/repack-plugin-rsc/server' {
  interface Register {
    server: typeof server;
  }
}

const schema: RscStandardSchemaV1<{ value: number }, { value: string }> = {
  '~standard': {
    validate: (input) => ({ value: { value: String(input) } }),
    vendor: 'test',
    version: 1,
  },
};

const permissions = createMiddleware().server(({ next }) =>
  next({ context: { permissions: ['read'] } })
);

const action = createServerFn()
  .inputValidator(schema)
  .middleware([permissions])
  .handler(
    ({ context, data }) =>
      context.requestId + context.viewerId + context.permissions[0] + data.value
  );

const invocation: Parameters<typeof action>[0] = { data: { value: 42 } };
const result: Awaited<ReturnType<typeof action>> = 'viewer-42';

void invocation;
void result;
void bareContext;
void logger;
`
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          noEmit: true,
          preserveSymlinks: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
        files: ['./index.ts'],
      })
    );

    expect(() =>
      execFileSync(
        path.join(packageRoot, 'node_modules', '.bin', 'tsc'),
        ['--project', path.join(consumerRoot, 'tsconfig.json')],
        {
          cwd: consumerRoot,
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });

  it('typechecks the root plugin entry', () => {
    const consumerRoot = path.join(temporaryDirectory, 'root-entry-consumer');
    const consumerPackageDirectory = path.join(
      consumerRoot,
      'node_modules',
      '@callstack'
    );
    fs.mkdirSync(consumerPackageDirectory, { recursive: true });
    fs.symlinkSync(
      extractedPackageRoot,
      path.join(consumerPackageDirectory, 'repack-plugin-rsc'),
      'dir'
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'index.ts'),
      `
import { RscPlugin } from '@callstack/repack-plugin-rsc';

const plugin = new RscPlugin({
  name: 'widget',
  runtime: './runtime.ts',
  runtimeVersion: '7',
  server: { roots: ['./src'], setup: './server.ts' },
});
void plugin;
`
    );
    fs.writeFileSync(
      path.join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
        files: ['./index.ts'],
      })
    );

    expect(() =>
      execFileSync(
        path.join(packageRoot, 'node_modules', '.bin', 'tsc'),
        ['--project', path.join(consumerRoot, 'tsconfig.json')],
        {
          cwd: consumerRoot,
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });
});
