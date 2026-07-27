export interface RscServerDefinition<Context> {
  readonly '~types'?: {
    readonly context: Context;
  };
}

// Declaration merging is the public, type-only registration mechanism.
// biome-ignore lint/suspicious/noEmptyInterface: applications augment this interface
export interface Register {}

type RegisteredServer = Register extends { readonly server: infer Server }
  ? Server
  : never;

export type RegisteredRscContext = [RegisteredServer] extends [never]
  ? unknown
  : RegisteredServer extends RscServerDefinition<infer Context>
    ? Context
    : unknown;
