import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJsTransformRules, RepackPlugin } from '@callstack/repack';
import type { RuleSetRule } from '@rspack/core';
import { describe, expect, inject, it } from 'vitest';
import { collectSwcLoaderOptions, createCompiler } from '../helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getJsxDevelopmentFlags(
  mode: 'development' | 'production',
  rules: unknown[]
) {
  const compiler = await createCompiler({
    context: __dirname,
    mode,
    entry: './index.js',
    output: { path: '/out' },
    module: { rules: rules as RuleSetRule[] },
    plugins: [new RepackPlugin({ platform: 'ios' })],
  });

  return collectSwcLoaderOptions(compiler.options.module.rules).map(
    (options) => options.jsc?.transform?.react?.development
  );
}

// builtin:swc-loader only exists in Rspack
describe.runIf(inject('bundlerType') === 'rspack')('RepackPlugin', () => {
  it.each([
    ['development', true],
    ['production', false],
  ] as const)(
    'sets SWC JSX development transforms for %s mode',
    async (mode, development) => {
      const flags = await getJsxDevelopmentFlags(mode, getJsTransformRules());

      expect(flags.length).toBeGreaterThan(0);
      expect(new Set(flags)).toEqual(new Set([development]));
    }
  );

  it('keeps an explicit SWC JSX development option', async () => {
    const flags = await getJsxDevelopmentFlags(
      'development',
      getJsTransformRules({ swc: { development: false } })
    );

    expect(flags.length).toBeGreaterThan(0);
    expect(new Set(flags)).toEqual(new Set([false]));
  });
});
