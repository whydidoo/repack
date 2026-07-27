import { RscExtractionError, extractRscDeclarations } from '../index.js';

function captureExtractionError(callback: () => void): RscExtractionError {
  try {
    callback();
  } catch (error) {
    if (error instanceof RscExtractionError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected RscExtractionError to be thrown');
}

describe('extractRscDeclarations root pruning', () => {
  it('replaces a root renderer with a client proxy and logical identity', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      "import { serverSecret } from './server-only';",
      '',
      'export const Team = defineRscRoot({',
      '  props: TeamPropsSchema,',
      "  reloadOn: ['teamId'],",
      "  pending: 'fallback',",
      '  async render({ props }) {',
      '    return serverSecret(props.teamId);',
      '  },',
      '});',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/roots/Team.rsc.tsx',
      graph: 'client',
      source,
      sourcePath: 'roots/Team.rsc.tsx',
      unit: 'team',
    });

    expect(result.roots).toEqual([
      {
        identity: {
          exportName: 'Team',
          sourcePath: 'roots/Team.rsc.tsx',
        },
        pending: 'fallback',
        props: { kind: 'standard-schema' },
        reloadOn: ['teamId'],
      },
    ]);
    expect(result.code).toContain("from 'repack:rsc/team/client-runtime';");
    expect(result.code).toContain(
      'export const Team = __repack_createRscRootProxy({' +
        '"exportName":"Team","sourcePath":"roots/Team.rsc.tsx"' +
        '}, {"pending":"fallback","reloadOn":["teamId"]});'
    );
    expect(result.code).not.toContain('async render');
    expect(result.code).not.toContain('return serverSecret(props.teamId)');
    expect(result.code).not.toContain("from './server-only'");
  });

  it('extracts the short root form without props metadata', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'export const Home = defineRscRoot(async ({ context }) => {',
      '  return context.home;',
      '});',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/roots/Home.rsc.tsx',
      graph: 'client',
      source,
      sourcePath: 'roots/Home.rsc.tsx',
      unit: 'home',
    });

    expect(result.roots).toEqual([
      {
        identity: {
          exportName: 'Home',
          sourcePath: 'roots/Home.rsc.tsx',
        },
        props: { kind: 'none' },
      },
    ]);
    expect(result.code).not.toContain('return context.home');
  });

  it('recognizes a static string props key as Standard Schema metadata', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'export const Team = defineRscRoot({',
      "  'props': TeamPropsSchema,",
      "  'reloadOn': ['teamId'],",
      '  render: async () => null,',
      '});',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/roots/Team.rsc.tsx',
      graph: 'client',
      source,
      sourcePath: 'roots/Team.rsc.tsx',
      unit: 'team',
    });

    expect(result.roots[0]?.props).toEqual({ kind: 'standard-schema' });
  });

  it('rejects a root with props when reloadOn is missing', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'export const Team = defineRscRoot({',
      '  props: TeamPropsSchema,',
      '  render: async () => null,',
      '});',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/roots/Team.rsc.tsx',
        graph: 'client',
        source,
        sourcePath: 'roots/Team.rsc.tsx',
        unit: 'team',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_ROOT_RELOAD_ON_REQUIRED',
      message:
        'RSC root "Team" with props requires a non-empty static reloadOn list.\n' +
        "Declare primitive identity fields: reloadOn: ['teamId'].",
    });
  });

  it('rejects an empty or dynamic reloadOn list', () => {
    for (const reloadOn of ['[]', 'identityFields']) {
      const source = [
        "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
        '',
        'export const Team = defineRscRoot({',
        '  props: TeamPropsSchema,',
        `  reloadOn: ${reloadOn},`,
        '  render: async () => null,',
        '});',
      ].join('\n');

      const error = captureExtractionError(() =>
        extractRscDeclarations({
          filename: '/project/src/roots/Team.rsc.tsx',
          graph: 'client',
          source,
          sourcePath: 'roots/Team.rsc.tsx',
          unit: 'team',
        })
      );

      expect(error.code).toBe('RSC_ROOT_RELOAD_ON_REQUIRED');
    }
  });

  it('rejects a dynamic or unsupported pending policy', () => {
    for (const pending of ['pendingPolicy', "'stale'"]) {
      const source = [
        "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
        '',
        'export const Team = defineRscRoot({',
        '  props: TeamPropsSchema,',
        "  reloadOn: ['teamId'],",
        `  pending: ${pending},`,
        '  render: async () => null,',
        '});',
      ].join('\n');

      const error = captureExtractionError(() =>
        extractRscDeclarations({
          filename: '/project/src/roots/Team.rsc.tsx',
          graph: 'client',
          source,
          sourcePath: 'roots/Team.rsc.tsx',
          unit: 'team',
        })
      );

      expect(error).toMatchObject({
        code: 'RSC_ROOT_PENDING_INVALID',
        message:
          'RSC root "Team" has an invalid pending policy.\n' +
          "Use pending: 'retain' or pending: 'fallback'.",
      });
    }
  });

  it('uses the canonical source path rather than the machine filename in identity', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      'export const Home = defineRscRoot(async () => null);',
    ].join('\n');
    const extract = (filename: string) =>
      extractRscDeclarations({
        filename,
        graph: 'client',
        source,
        sourcePath: 'roots/Home.rsc.tsx',
        unit: 'home',
      });

    expect(extract('/machine-a/project/src/Home.tsx').roots).toEqual(
      extract('/machine-b/worktree/src/Home.tsx').roots
    );
  });

  it('keeps the renderer and excludes client proxy code in the server graph', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'export const Home = defineRscRoot(async ({ context }) => {',
      '  return context.home;',
      '});',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/roots/Home.rsc.tsx',
      graph: 'server',
      source,
      sourcePath: 'roots/Home.rsc.tsx',
      unit: 'home',
    });

    expect(result.code).toBe(source);
    expect(result.code).toContain('return context.home');
    expect(result.code).not.toContain('__repack_createRscRootProxy');
  });

  it('rejects an object root without a props schema', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'export const Home = defineRscRoot({',
      '  async render({ context }) {',
      '    return context.home;',
      '  },',
      '});',
    ].join('\n');

    const error = captureExtractionError(() =>
      extractRscDeclarations({
        filename: '/project/src/roots/Home.rsc.tsx',
        graph: 'client',
        source,
        sourcePath: 'roots/Home.rsc.tsx',
        unit: 'home',
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_ROOT_SHORT_FORM_REQUIRED',
      filename: '/project/src/roots/Home.rsc.tsx',
      location: { column: 13, line: 3 },
      message:
        'RSC root "Home" has no props schema.\n' +
        'Use the short form: export const Home = defineRscRoot(async ({ context }) => ...).',
    });
  });

  it('avoids collisions with application bindings in generated proxy code', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      "const __repack_createRscRootProxy = 'application value';",
      'export const Home = defineRscRoot(async () => null);',
    ].join('\n');

    const result = extractRscDeclarations({
      filename: '/project/src/roots/Home.rsc.tsx',
      graph: 'client',
      source,
      sourcePath: 'roots/Home.rsc.tsx',
      unit: 'home',
    });

    expect(result.code).toContain(
      'createRscRootProxy as __repack_createRscRootProxy_1'
    );
    expect(result.code).toContain(
      'export const Home = __repack_createRscRootProxy_1('
    );
  });
});
