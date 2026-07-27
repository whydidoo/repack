import type { ComponentProps } from 'react';
import { RscValidationError } from '../../index.js';
import { defineRscRoot } from '../index.js';
import type { RscStandardSchemaV1 } from '../index.js';
import { prepareRscRoot } from '../root.js';

describe('defineRscRoot', () => {
  it('rejects invalid props before running the renderer', async () => {
    let rendererCalled = false;
    const schema: RscStandardSchemaV1<unknown, { teamId: string }> = {
      '~standard': {
        validate: () => ({
          issues: [{ message: 'Expected a string', path: ['teamId'] }],
        }),
        vendor: 'test',
        version: 1,
      },
    };
    const Team = defineRscRoot({
      props: schema,
      reloadOn: ['teamId'],
      render: () => {
        rendererCalled = true;
        return null;
      },
    });

    await expect(
      prepareRscRoot(Team)({
        context: {},
        props: { teamId: 42 },
      })
    ).rejects.toEqual(
      new RscValidationError({
        issues: [{ message: 'Expected a string', path: ['teamId'] }],
      })
    );
    expect(rendererCalled).toBe(false);
  });

  it('passes validated schema output to the renderer', async () => {
    const schema: RscStandardSchemaV1<unknown, { teamId: string }> = {
      '~standard': {
        validate: (value) => ({
          value: { teamId: String(value) },
        }),
        vendor: 'test',
        version: 1,
      },
    };
    const Team = defineRscRoot({
      props: schema,
      reloadOn: ['teamId'],
      render: ({ props }) => props.teamId,
    });

    await expect(
      prepareRscRoot(Team)({ context: {}, props: 42 })
    ).resolves.toBe('42');
  });

  it('renders the short form without validating props', async () => {
    const Home = defineRscRoot(({ context }) =>
      context.viewer.id === 'viewer-42' ? 'home' : 'unexpected'
    );

    await expect(
      prepareRscRoot(Home)({
        context: { viewer: { id: 'viewer-42' } },
        props: { ignored: true },
      })
    ).resolves.toBe('home');
  });

  it('infers client component props from Standard Schema output', () => {
    const schema: RscStandardSchemaV1<unknown, { teamId: string }> = {
      '~standard': {
        validate: (value) =>
          typeof value === 'object' &&
          value !== null &&
          'teamId' in value &&
          typeof value.teamId === 'string'
            ? { value: { teamId: value.teamId } }
            : { issues: [{ message: 'Expected teamId' }] },
        vendor: 'test',
        version: 1,
      },
    };
    const Team = defineRscRoot({
      props: schema,
      pending: 'fallback',
      reloadOn: ['teamId'],
      render: ({ props }) => props.teamId,
    });
    const props: ComponentProps<typeof Team> = {
      teamId: '42',
    };

    expect(props).toEqual({ teamId: '42' });
  });

  it('requires primitive reload fields for roots with props', () => {
    const schema: RscStandardSchemaV1<
      unknown,
      { filters: { active: boolean }; teamId?: string }
    > = {
      '~standard': {
        validate: () => ({
          value: { filters: { active: false }, teamId: undefined },
        }),
        vendor: 'test',
        version: 1,
      },
    };

    // @ts-expect-error reloadOn is required for roots with props.
    defineRscRoot({ props: schema, render: () => null });

    // @ts-expect-error Object-valued fields cannot define request identity.
    defineRscRoot({
      props: schema,
      reloadOn: ['filters'],
      render: () => null,
    });

    // @ts-expect-error reloadOn only accepts schema output field names.
    defineRscRoot({
      props: schema,
      reloadOn: ['missing'],
      render: () => null,
    });

    expect(true).toBe(true);
  });
});
