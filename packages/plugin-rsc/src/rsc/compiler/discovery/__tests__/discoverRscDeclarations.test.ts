import { RscDiscoveryError, discoverRscDeclarations } from '../index.js';

function captureDiscoveryError(callback: () => void): RscDiscoveryError {
  try {
    callback();
  } catch (error) {
    if (error instanceof RscDiscoveryError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected RscDiscoveryError to be thrown');
}

describe('discoverRscDeclarations', () => {
  it('discovers aliased top-level RSC declarations from the server subpath', () => {
    const source = [
      'import {',
      '  defineRscRoot as root,',
      '  createServerFn as serverFn,',
      '  createMiddleware as middleware,',
      "} from '@callstack/repack-plugin-rsc/server';",
      '',
      'export const Team = root(() => null);',
      'export const checkMe = serverFn().handler(() => null);',
      'const auth = middleware().server(() => null);',
    ].join('\n');

    expect(
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source,
      })
    ).toEqual({
      clientModule: false,
      declarations: [
        {
          exportName: 'Team',
          kind: 'root',
          location: {
            column: 13,
            line: 7,
          },
        },
        {
          exportName: 'checkMe',
          kind: 'server-function',
          location: {
            column: 13,
            line: 8,
          },
        },
        {
          kind: 'middleware',
          localName: 'auth',
          location: {
            column: 6,
            line: 9,
          },
        },
      ],
    });
  });

  it('ignores same-name functions that are not imported from the server subpath', () => {
    const source = [
      "import { defineRscRoot } from '@example/rsc';",
      "import { createServerFn as otherServerFn } from '@example/server';",
      '',
      'export const Team = defineRscRoot(() => null);',
      'export const checkMe = otherServerFn().handler(() => null);',
    ].join('\n');

    expect(
      discoverRscDeclarations({
        filename: '/project/src/unrelated.tsx',
        source,
      })
    ).toEqual({
      clientModule: false,
      declarations: [],
    });
  });

  it('ignores an imported factory name when it is shadowed by a local binding', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'export function invoke(defineRscRoot: () => unknown) {',
      '  return defineRscRoot();',
      '}',
    ].join('\n');

    expect(
      discoverRscDeclarations({
        filename: '/project/src/invoke.ts',
        source,
      })
    ).toEqual({
      clientModule: false,
      declarations: [],
    });
  });

  it('ignores an imported factory name shadowed by a block-local binding', () => {
    const source = [
      "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
      '',
      'export function invoke() {',
      '  const defineRscRoot = () => null;',
      '  return defineRscRoot();',
      '}',
    ].join('\n');

    expect(
      discoverRscDeclarations({
        filename: '/project/src/invoke.ts',
        source,
      })
    ).toEqual({
      clientModule: false,
      declarations: [],
    });
  });

  it("marks a module with a 'use client' directive", () => {
    expect(
      discoverRscDeclarations({
        filename: '/project/src/Button.tsx',
        source: "'use client';\nexport function Button() { return null; }",
      })
    ).toEqual({
      clientModule: true,
      declarations: [],
    });
  });

  it('parses React Native Flow modules during discovery', () => {
    const source = [
      "'use client';",
      'type Props = {| label: string |};',
      'export function Button(props: Props): React.Node {',
      '  return null;',
      '}',
    ].join('\n');

    expect(
      discoverRscDeclarations({
        filename: '/project/src/Button.js',
        source,
      })
    ).toEqual({
      clientModule: true,
      declarations: [],
    });
  });

  it("rejects a module-level 'use server' directive with migration guidance", () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/action.ts',
        source: "'use server';\nexport async function action() {}",
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_USE_SERVER_UNSUPPORTED',
      filename: '/project/src/action.ts',
      location: { column: 0, line: 1 },
      message:
        "'use server' is not supported by Re.Pack RSC.\n" +
        'Declare server functions with createServerFn().',
    });
  });

  it("rejects 'use server' inside a function body", () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/action.ts',
        source: [
          'export async function action() {',
          "  'use server';",
          '}',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_USE_SERVER_UNSUPPORTED',
      filename: '/project/src/action.ts',
      location: { column: 2, line: 2 },
      message:
        "'use server' is not supported by Re.Pack RSC.\n" +
        'Declare server functions with createServerFn().',
    });
  });

  it('rejects a root that is not exported with source-located guidance', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source: [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          '',
          'const Team = defineRscRoot(() => null);',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_NOT_EXPORTED',
      filename: '/project/src/team.rsc.tsx',
      location: { column: 6, line: 3 },
      message:
        'RSC root "Team" must be declared as a named top-level export const.\n' +
        'Move it to: export const Team = defineRscRoot(...).',
    });
  });

  it('rejects a default RSC declaration', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source: [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          '',
          'export default defineRscRoot(() => null);',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_DEFAULT_EXPORT',
      filename: '/project/src/team.rsc.tsx',
      location: { column: 15, line: 3 },
      message:
        'RSC declarations cannot use a default export.\n' +
        'Declare a named top-level export instead: export const Root = defineRscRoot(...).',
    });
  });

  it('guides a default middleware declaration to a local const', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/auth.ts',
        source: [
          "import { createMiddleware } from '@callstack/repack-plugin-rsc/server';",
          '',
          'export default createMiddleware().server(() => null);',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_DEFAULT_EXPORT',
      filename: '/project/src/auth.ts',
      location: { column: 15, line: 3 },
      message:
        'RSC declarations cannot use a default export.\n' +
        'Declare local middleware instead: const middleware = createMiddleware(...).',
    });
  });

  it('rejects a nested RSC declaration', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source: [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          '',
          'export function makeTeam() {',
          '  return defineRscRoot(() => null);',
          '}',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_NOT_TOP_LEVEL',
      filename: '/project/src/team.rsc.tsx',
      location: { column: 9, line: 4 },
      message:
        'RSC root declarations cannot be nested.\n' +
        'Move this call to a named top-level export const.',
    });
  });

  it('rejects a conditional RSC declaration as dynamic', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source: [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          '',
          'export const Team = enabled ? defineRscRoot(() => null) : null;',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_DYNAMIC',
      filename: '/project/src/team.rsc.tsx',
      location: { column: 13, line: 3 },
      message:
        'RSC root "Team" must be initialized by one direct defineRscRoot(...) call.\n' +
        'Remove conditional or computed declaration logic.',
    });
  });

  it('rejects an indirect factory invocation as dynamic', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source: [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          '',
          'export const Team = defineRscRoot.call(null, () => null);',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_DYNAMIC',
      filename: '/project/src/team.rsc.tsx',
      location: { column: 13, line: 3 },
      message:
        'RSC root "Team" must be initialized by one direct defineRscRoot(...) call.\n' +
        'Remove conditional or computed declaration logic.',
    });
  });

  it('rejects a local factory alias as dynamic', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source: [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          '',
          'const f = defineRscRoot;',
          'export const Root = f(() => null);',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_DYNAMIC',
      filename: '/project/src/team.rsc.tsx',
      location: { column: 6, line: 3 },
      message:
        'RSC root "f" must be initialized by one direct defineRscRoot(...) call.\n' +
        'Remove conditional or computed declaration logic.',
    });
  });

  it('rejects a mutable Server Function declaration', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/checkMe.ts',
        source: [
          "import { createServerFn } from '@callstack/repack-plugin-rsc/server';",
          '',
          'export let checkMe = createServerFn().handler(() => null);',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_NOT_CONST',
      filename: '/project/src/checkMe.ts',
      location: { column: 11, line: 3 },
      message:
        'Server Function "checkMe" must be declared with const.\n' +
        'Change it to: export const checkMe = createServerFn(...).',
    });
  });

  it('rejects a destructured RSC declaration', () => {
    const error = captureDiscoveryError(() =>
      discoverRscDeclarations({
        filename: '/project/src/team.rsc.tsx',
        source: [
          "import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';",
          '',
          'export const { Team } = defineRscRoot(() => null);',
        ].join('\n'),
      })
    );

    expect(error).toMatchObject({
      code: 'RSC_DECLARATION_NOT_NAMED',
      filename: '/project/src/team.rsc.tsx',
      location: { column: 13, line: 3 },
      message:
        'RSC root declarations must use a single identifier.\n' +
        'Change this to a named top-level export const declaration.',
    });
  });
});
