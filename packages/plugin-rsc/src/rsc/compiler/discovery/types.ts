export type RscDeclarationKind = 'middleware' | 'root' | 'server-function';

export interface RscSourceLocation {
  readonly column: number;
  readonly line: number;
}

interface RscDeclarationBase {
  readonly location: RscSourceLocation;
}

export interface RscRootDeclaration extends RscDeclarationBase {
  readonly exportName: string;
  readonly kind: 'root';
}

export interface RscServerFunctionDeclaration extends RscDeclarationBase {
  readonly exportName: string;
  readonly kind: 'server-function';
}

export interface RscMiddlewareDeclaration extends RscDeclarationBase {
  readonly kind: 'middleware';
  readonly localName: string;
}

export type RscDeclaration =
  | RscMiddlewareDeclaration
  | RscRootDeclaration
  | RscServerFunctionDeclaration;

export interface DiscoverRscDeclarationsInput {
  readonly filename: string;
  readonly source: string;
}

export interface RscDiscoveryResult {
  readonly clientModule: boolean;
  readonly declarations: readonly RscDeclaration[];
}
