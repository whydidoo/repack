import type { ComponentType, ReactNode } from 'react';
import type { RscPendingPolicy, RscReloadOn } from '../rootTypes.js';
import type { RegisteredRscContext } from './registration.js';
import { validateRscSchema } from './schema.js';
import type { InferRscSchemaOutput, RscStandardSchemaV1 } from './schema.js';

type RscRootProps<Schema extends RscStandardSchemaV1> =
  InferRscSchemaOutput<Schema> extends object
    ? InferRscSchemaOutput<Schema>
    : never;

export interface RscRootRenderInput<Props, Context = RegisteredRscContext> {
  readonly context: Context;
  readonly props: Props;
}

export interface RscRootDefinition<
  Schema extends RscStandardSchemaV1,
  Context = RegisteredRscContext,
> {
  readonly props: Schema;
  readonly reloadOn: RscReloadOn<RscRootProps<Schema>>;
  readonly pending?: RscPendingPolicy;
  readonly render: (
    input: RscRootRenderInput<RscRootProps<Schema>, Context>
  ) => Promise<ReactNode> | ReactNode;
}

export type RscRootWithoutPropsRenderer<Context = RegisteredRscContext> =
  (input: {
    readonly context: Context;
  }) => Promise<ReactNode> | ReactNode;

interface InternalRscRootDefinition {
  readonly renderer: (input: {
    readonly context: unknown;
    readonly props: unknown;
  }) => Promise<ReactNode> | ReactNode;
  readonly schema?: RscStandardSchemaV1;
}

export type PreparedRscRoot = (input: {
  readonly context: unknown;
  readonly props: unknown;
}) => Promise<ReactNode>;

const RSC_ROOT_DEFINITION = Symbol('repack.rsc.root.definition');

type InternalRscRoot = ComponentType<never> & {
  readonly [RSC_ROOT_DEFINITION]: InternalRscRootDefinition;
};

export function defineRscRoot<Schema extends RscStandardSchemaV1>(
  definition: RscRootDefinition<Schema>
): ComponentType<RscRootProps<Schema>>;
export function defineRscRoot(
  renderer: RscRootWithoutPropsRenderer
): ComponentType<Record<string, never>>;
export function defineRscRoot(
  definition:
    | RscRootDefinition<RscStandardSchemaV1>
    | RscRootWithoutPropsRenderer
): unknown {
  const internalDefinition: InternalRscRootDefinition =
    typeof definition === 'function'
      ? {
          renderer: ({ context }) => definition({ context: context as never }),
        }
      : {
          renderer: ({ context, props }) =>
            definition.render({
              context: context as never,
              props: props as never,
            }),
          schema: definition.props,
        };
  const root = () => {
    throw new Error(
      'An RSC root cannot be rendered directly in the server graph.'
    );
  };
  Object.defineProperty(root, RSC_ROOT_DEFINITION, {
    value: internalDefinition,
  });
  return root;
}

export function prepareRscRoot(root: unknown): PreparedRscRoot {
  if (typeof root !== 'function' || !(RSC_ROOT_DEFINITION in root)) {
    throw new TypeError('Expected a root created by defineRscRoot().');
  }

  const definition = (root as InternalRscRoot)[RSC_ROOT_DEFINITION];
  const renderer = definition.renderer;
  const schema = definition.schema;
  return async (input) => {
    if (!schema) {
      return renderer(input);
    }

    return renderer({
      context: input.context,
      props: await validateRscSchema(schema, input.props),
    });
  };
}
