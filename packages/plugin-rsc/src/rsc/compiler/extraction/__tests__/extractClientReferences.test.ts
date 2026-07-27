import { extractRscDeclarations } from '../index.js';

describe('extractRscDeclarations Client References', () => {
  it('replaces a client module with inert RSDW references in the server graph', () => {
    const source = [
      "'use client';",
      "import { secret } from './client-only';",
      'export default function Counter() { return secret; }',
      'export function Button() { return secret; }',
    ].join('\n');

    const result = extractRscDeclarations({
      clientReferences: [
        {
          exportName: 'default',
          id: 'rsc_default',
          targetExportName: 'default',
        },
        {
          exportName: 'Button',
          id: 'rsc_button',
          targetExportName: 'Button',
        },
      ],
      filename: '/project/src/Counter.tsx',
      graph: 'server',
      source,
      sourcePath: 'Counter.tsx',
      unit: 'widget',
    });

    expect(result.code).toContain("from 'repack:rsc/internal/flight-server';");
    expect(result.code).toContain('}, "rsc_default", "default");');
    expect(result.code).toContain(
      'export { __repack_client_reference_0 as default };'
    );
    expect(result.code).toContain('}, "rsc_button", "Button");');
    expect(result.code).toContain(
      'export { __repack_client_reference_1 as Button };'
    );
    expect(result.code).not.toContain("from './client-only'");
    expect(result.code).not.toContain('return secret');
    expect(result.code.split('\n').slice(0, 4)).toEqual(['', '', '', '']);
  });

  it('keeps the public alias while registering its target export name', () => {
    const result = extractRscDeclarations({
      clientReferences: [
        {
          exportName: 'PrimaryButton',
          id: 'rsc_alias',
          targetExportName: 'Button',
        },
      ],
      filename: '/project/src/design-system.ts',
      graph: 'server',
      source:
        "export { Button as PrimaryButton, icon as iconName } from './Button';",
      sourcePath: 'design-system.ts',
      unit: 'widget',
    });

    expect(result.code).toContain('}, "rsc_alias", "Button");');
    expect(result.code).toContain(
      'export { __repack_client_reference_0 as PrimaryButton };'
    );
    expect(result.code).toContain(
      'export { icon as iconName } from "./Button";'
    );
    expect(result.code).not.toContain('Button as PrimaryButton');
  });

  it('does not replace a client module in the mobile graph', () => {
    const source = "'use client';\nexport const Button = () => null;";
    const result = extractRscDeclarations({
      clientReferences: [
        {
          exportName: 'Button',
          id: 'rsc_button',
          targetExportName: 'Button',
        },
      ],
      filename: '/project/src/Button.tsx',
      graph: 'client',
      source,
      sourcePath: 'Button.tsx',
      unit: 'widget',
    });

    expect(result.code).toBe(source);
  });

  it('makes an export-less client module inert in the server graph', () => {
    const source = "'use client';\nstartClientAnalytics();";
    const result = extractRscDeclarations({
      filename: '/project/src/analytics.ts',
      graph: 'server',
      source,
      sourcePath: 'analytics.ts',
      unit: 'widget',
    });

    expect(result.code).not.toContain('startClientAnalytics');
    expect(result.code).not.toContain('registerClientReference');
    expect(result.code.split('\n').slice(0, 2)).toEqual(['', '']);
  });
});
