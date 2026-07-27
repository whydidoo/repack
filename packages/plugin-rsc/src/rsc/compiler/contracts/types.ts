import type {
  RscChunkReference,
  RscClientReferenceContract,
  RscLogicalIdentity,
} from '../../artifacts/types.js';
import type { RscSourceLocation } from '../discovery/types.js';

export type RscIndexedContractKind =
  | 'client-reference'
  | 'root'
  | 'server-function';

export interface RscContractSourceModule {
  readonly filename: string;
  readonly source: string;
  readonly sourcePath: string;
}

export interface ResolveRscContractModuleInput {
  readonly importer: string;
  readonly specifier: string;
}

export type ResolveRscContractModule = (
  input: ResolveRscContractModuleInput
) => string | undefined;

export interface IndexRscContractsInput {
  readonly modules: readonly RscContractSourceModule[];
  readonly resolve: ResolveRscContractModule;
}

export interface RscIndexedContractTarget extends RscLogicalIdentity {
  readonly filename: string;
}

/** The source declaration or re-export that claims a logical RSC identity. */
export interface RscIndexedContractClaim {
  readonly filename: string;
  readonly location: RscSourceLocation;
}

export interface RscIndexedContract {
  readonly claim: RscIndexedContractClaim;
  readonly identity: RscLogicalIdentity;
  readonly kind: RscIndexedContractKind;
  readonly target: RscIndexedContractTarget;
}

export interface RscContractIndex {
  readonly clientEntries: readonly string[];
  readonly contracts: readonly RscIndexedContract[];
}

export interface RscCompiledClientModuleTarget {
  readonly async: boolean;
  readonly chunks: readonly RscChunkReference[];
  readonly filename: string;
  readonly moduleId: number | string;
}

/** A compiler-planned Client Reference claim ready for target projection. */
export interface RscClientReferenceProjectionClaim {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly targetExportName: string;
  readonly targetFilename: string;
}

export interface CreateRscClientReferenceContractsInput {
  readonly claims: readonly RscClientReferenceProjectionClaim[];
  readonly mode: 'development' | 'production';
  readonly targets: readonly RscCompiledClientModuleTarget[];
  readonly unit: string;
}

export type RscClientReferenceContracts = readonly RscClientReferenceContract[];

export interface CreateRscContractIdInput {
  readonly identity: RscLogicalIdentity;
  readonly kind: RscIndexedContractKind;
  readonly mode: 'development' | 'production';
  readonly unit: string;
}
