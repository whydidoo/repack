import type { RscLogicalIdentity } from '../../artifacts/types.js';

export interface ExtractRscDeclarationsInput {
  readonly clientReferences?: readonly ExtractedRscClientReference[];
  readonly filename: string;
  readonly graph: 'client' | 'server';
  readonly source: string;
  readonly sourcePath: string;
  readonly unit: string;
}

export interface ExtractedRscClientReference {
  readonly exportName: string;
  readonly id: string;
  readonly targetExportName: string;
}

export type ExtractedRscRoot =
  | {
      readonly identity: RscLogicalIdentity;
      readonly props: { readonly kind: 'none' };
    }
  | {
      readonly identity: RscLogicalIdentity;
      readonly pending: 'fallback' | 'retain';
      readonly props: { readonly kind: 'standard-schema' };
      readonly reloadOn: readonly string[];
    };

export interface ExtractedRscServerFunction {
  readonly identity: RscLogicalIdentity;
  readonly input:
    | { readonly kind: 'none' }
    | { readonly kind: 'standard-schema' };
  readonly middleware: readonly string[];
}

export interface ExtractedRscMiddleware {
  readonly client: boolean;
  readonly localName: string;
  readonly server: boolean;
}

export interface ExtractRscDeclarationsResult {
  readonly code: string;
  readonly middleware: readonly ExtractedRscMiddleware[];
  readonly roots: readonly ExtractedRscRoot[];
  readonly serverFunctions: readonly ExtractedRscServerFunction[];
}
