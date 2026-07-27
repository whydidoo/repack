import { normalizeRscConfig } from '../normalizeRscConfig.js';

describe('normalizeRscConfig', () => {
  it('normalizes module and root paths relative to compiler context', () => {
    expect(
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src', '/shared/components'],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toEqual({
      name: 'widget',
      runtimeVersion: '7',
      runtime: '/project/app/src/rsc.runtime.ts',
      server: {
        roots: ['/project/app/src', '/shared/components'],
        setup: '/project/app/src/rsc.server.ts',
      },
    });
  });

  it('rejects a unit name that is not a path-safe identifier', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: '../widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow('RscPlugin.name must be a non-empty path-safe identifier');
  });

  it('rejects a non-string unit name', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 42,
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow('RscPlugin.name must be a non-empty path-safe identifier');
  });

  it('rejects a runtime version that is not a path-safe identifier', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '../8',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow(
      'RscPlugin.runtimeVersion must be a non-empty path-safe identifier'
    );
  });

  it('rejects a non-string runtime version', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: 7,
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow(
      'RscPlugin.runtimeVersion must be a non-empty path-safe identifier'
    );
  });

  it('rejects an empty application runtime module path', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: ' ',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow('RscPlugin.runtime must be a non-empty module path');
  });

  it('rejects an empty server setup module path', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
            setup: ' ',
          },
        },
        '/project/app'
      )
    ).toThrow('RscPlugin.server.setup must be a non-empty module path');
  });

  it('requires at least one non-empty server root', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: [],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow(
      'RscPlugin.server.roots must contain at least one non-empty path'
    );
  });

  it('reports a configuration error for a non-object value', () => {
    expect(() => normalizeRscConfig(null as never, '/project/app')).toThrow(
      'RscPlugin must be an object'
    );
  });

  it('reports a configuration error when server configuration is missing', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
        },
        '/project/app'
      )
    ).toThrow('RscPlugin.server must be an object');
  });

  it('reports a configuration error when runtime module is missing', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          server: {
            roots: ['./src'],
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow('RscPlugin.runtime must be a non-empty module path');
  });

  it('reports a configuration error when server setup is missing', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            roots: ['./src'],
          },
        },
        '/project/app'
      )
    ).toThrow('RscPlugin.server.setup must be a non-empty module path');
  });

  it('reports a configuration error when server roots are missing', () => {
    expect(() =>
      normalizeRscConfig(
        {
          name: 'widget',
          runtimeVersion: '7',
          runtime: './src/rsc.runtime.ts',
          server: {
            setup: './src/rsc.server.ts',
          },
        },
        '/project/app'
      )
    ).toThrow(
      'RscPlugin.server.roots must contain at least one non-empty path'
    );
  });
});
