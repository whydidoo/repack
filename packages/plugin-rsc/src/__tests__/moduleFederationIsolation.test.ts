import type { Compiler } from '@rspack/core';
import { applyRscModuleFederationIsolation } from '../moduleFederationIsolation.js';

class Hook {
  private callback?: () => void;

  tap(_name: string, callback: () => void): void {
    this.callback = callback;
  }

  call(): void {
    this.callback?.();
  }
}

function createCompiler(builtinPlugins: unknown[]): {
  readonly compiler: Compiler;
  readonly afterResolvers: Hook;
} {
  const afterResolvers = new Hook();
  return {
    afterResolvers,
    compiler: {
      __internal__builtinPlugins: builtinPlugins,
      hooks: { afterResolvers },
    } as unknown as Compiler,
  };
}

describe('applyRscModuleFederationIsolation', () => {
  it.each([
    ['key', '@callstack/repack-plugin-rsc/client'],
    ['import', 'react-server-dom-webpack/client.node'],
    ['shareKey', 'repack:rsc/widget/client-runtime'],
    ['key', '@callstack/repack-plugin-rsc/'],
  ] as const)('rejects a protected consume %s', (field, request) => {
    const { afterResolvers, compiler } = createCompiler([
      {
        name: 'ConsumeSharedPlugin',
        options: { consumes: [{ [field]: request }] },
      },
    ]);
    applyRscModuleFederationIsolation(compiler);

    expect(() => afterResolvers.call()).toThrow(request);
  });

  it('rejects a protected provide registration', () => {
    const { afterResolvers, compiler } = createCompiler([
      {
        name: 'ProvideSharedPlugin',
        options: [{ key: '@callstack/repack-plugin-rsc/runtime' }],
      },
    ]);
    applyRscModuleFederationIsolation(compiler);

    expect(() => afterResolvers.call()).toThrow(
      '@callstack/repack-plugin-rsc/runtime'
    );
  });

  it('allows application shares and literal stars', () => {
    const { afterResolvers, compiler } = createCompiler([
      {
        name: 'ConsumeSharedPlugin',
        options: {
          consumes: [
            { key: '@app/feature-catalog' },
            { key: 'react-server-dom-webpack/*' },
          ],
        },
      },
      {
        name: 'ProvideSharedPlugin',
        options: [{ key: '@app/feature-catalog' }],
      },
    ]);
    applyRscModuleFederationIsolation(compiler);

    expect(() => afterResolvers.call()).not.toThrow();
  });

  it.each(['ConsumeSharedPlugin', 'ProvideSharedPlugin'])(
    'fails clearly when Rspack changes the %s representation',
    (name) => {
      const { afterResolvers, compiler } = createCompiler([
        { name, options: null },
      ]);
      applyRscModuleFederationIsolation(compiler);

      expect(() => afterResolvers.call()).toThrow(
        `does not recognize the installed Rspack ${name} representation`
      );
    }
  );
});
