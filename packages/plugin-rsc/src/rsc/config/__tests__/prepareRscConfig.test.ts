import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareRscConfig } from '../prepareRscConfig.js';

describe('prepareRscConfig', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repack-rsc-config-'));
    fs.mkdirSync(path.join(projectRoot, 'src'));
    fs.writeFileSync(path.join(projectRoot, 'src', 'rsc.runtime.ts'), '');
    fs.writeFileSync(path.join(projectRoot, 'src', 'rsc.server.ts'), '');

    for (const [packageName, version] of [
      ['react', '19.2.6'],
      ['react-server-dom-webpack', '19.2.6'],
    ]) {
      const packageDirectory = path.join(
        projectRoot,
        'node_modules',
        packageName
      );
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({
          name: packageName,
          version,
        })
      );
    }
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns a normalized Rspack configuration', () => {
    expect(
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        {
          bundler: 'rspack',
          context: projectRoot,
        }
      )
    ).toEqual({
      name: 'widget',
      runtimeVersion: '7',
      runtime: path.join(projectRoot, 'src', 'rsc.runtime.ts'),
      server: {
        roots: [path.join(projectRoot, 'src')],
        setup: path.join(projectRoot, 'src', 'rsc.server.ts'),
      },
    });
  });

  it('allows React to follow the React Native renderer independently from RSDW', () => {
    fs.writeFileSync(
      path.join(projectRoot, 'node_modules', 'react', 'package.json'),
      JSON.stringify({
        name: 'react',
        version: '19.2.3',
      })
    );

    expect(() =>
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        {
          bundler: 'rspack',
          context: projectRoot,
        }
      )
    ).not.toThrow();
  });

  it('rejects RSC when RepackPlugin runs with Webpack', () => {
    expect(() =>
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        {
          bundler: 'webpack',
          context: projectRoot,
        }
      )
    ).toThrow(
      'RscPlugin is only supported with Rspack. Use the Rspack Re.Pack commands or remove the rsc option.'
    );
  });

  it('rejects a runtime module that does not exist', () => {
    expect(() =>
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/missing.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        {
          bundler: 'rspack',
          context: projectRoot,
        }
      )
    ).toThrow(
      `RscPlugin.runtime does not exist: ${path.join(
        projectRoot,
        'src',
        'missing.runtime.ts'
      )}`
    );
  });

  it('rejects a server setup module that does not exist', () => {
    expect(() =>
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/missing.server.ts',
          },
        },
        {
          bundler: 'rspack',
          context: projectRoot,
        }
      )
    ).toThrow(
      `RscPlugin.server.setup does not exist: ${path.join(
        projectRoot,
        'src',
        'missing.server.ts'
      )}`
    );
  });

  it('rejects a server root that is not a directory', () => {
    expect(() =>
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./missing'],
            setup: './src/rsc.server.ts',
          },
        },
        {
          bundler: 'rspack',
          context: projectRoot,
        }
      )
    ).toThrow(
      `RscPlugin.server.roots must contain existing directories: ${path.join(
        projectRoot,
        'missing'
      )}`
    );
  });

  it('rejects a missing RSC peer dependency', () => {
    try {
      jest.isolateModules(() => {
        jest.doMock('node:module', () => ({
          createRequire: () => ({
            resolve: () => {
              throw new Error('MODULE_NOT_FOUND');
            },
          }),
        }));
        const {
          prepareRscConfig: prepareRscConfigWithoutPeers,
        }: typeof import(
          '../prepareRscConfig.js'
        ) = require('../prepareRscConfig.js');

        expect(() =>
          prepareRscConfigWithoutPeers(
            {
              name: 'widget',
              runtimeVersion: '7',
              runtime: './src/rsc.runtime.ts',
              server: {
                roots: ['./src'],
                setup: './src/rsc.server.ts',
              },
            },
            {
              bundler: 'rspack',
              context: projectRoot,
            }
          )
        ).toThrow(
          `RscPlugin does not support the installed RSC dependencies (react@missing and react-server-dom-webpack@missing). Supported ranges are react@>=19.2.3 <19.3.0 and react-server-dom-webpack@>=19.2.6 <19.3.0. Install compatible versions in ${projectRoot}.`
        );
      });
    } finally {
      jest.dontMock('node:module');
    }
  });

  it('rejects an incompatible RSC peer dependency', () => {
    fs.writeFileSync(
      path.join(projectRoot, 'node_modules', 'react', 'package.json'),
      JSON.stringify({
        name: 'react',
        version: '19.3.0',
      })
    );

    expect(() =>
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        {
          bundler: 'rspack',
          context: projectRoot,
        }
      )
    ).toThrow(
      `RscPlugin does not support the installed RSC dependencies (react@19.3.0 and react-server-dom-webpack@19.2.6). Supported ranges are react@>=19.2.3 <19.3.0 and react-server-dom-webpack@>=19.2.6 <19.3.0. Install compatible versions in ${projectRoot}.`
    );
  });

  it('rejects an RSDW version with known security vulnerabilities', () => {
    fs.writeFileSync(
      path.join(
        projectRoot,
        'node_modules',
        'react-server-dom-webpack',
        'package.json'
      ),
      JSON.stringify({
        name: 'react-server-dom-webpack',
        version: '19.2.5',
      })
    );

    expect(() =>
      prepareRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        {
          bundler: 'rspack',
          context: projectRoot,
        }
      )
    ).toThrow(
      `RscPlugin does not support the installed RSC dependencies (react@19.2.6 and react-server-dom-webpack@19.2.5). Supported ranges are react@>=19.2.3 <19.3.0 and react-server-dom-webpack@>=19.2.6 <19.3.0. Install compatible versions in ${projectRoot}.`
    );
  });
});
