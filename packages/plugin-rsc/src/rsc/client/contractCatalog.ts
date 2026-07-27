import type {
  RscAddressableContract,
  RscLogicalIdentity,
} from '../artifacts/types.js';
import {
  createRscLogicalIdentityKey,
  formatRscLogicalIdentity,
} from '../identity.js';

export type RscClientContractKind = 'root' | 'serverFunction';

export interface RscClientContractCatalog {
  resolve(kind: RscClientContractKind, identity: RscLogicalIdentity): string;
}

export function createRscClientContractCatalog(input: {
  readonly roots: readonly RscAddressableContract[];
  readonly serverFunctions: readonly RscAddressableContract[];
}): RscClientContractCatalog {
  const contracts = {
    root: indexContracts('root', input.roots),
    serverFunction: indexContracts('serverFunction', input.serverFunctions),
  };

  return Object.freeze({
    resolve(kind: RscClientContractKind, identity: RscLogicalIdentity): string {
      const id = contracts[kind].get(createRscLogicalIdentityKey(identity));
      if (id === undefined) {
        throw new Error(missingContractMessage(kind, identity));
      }
      return id;
    },
  });
}

function indexContracts(
  kind: RscClientContractKind,
  source: readonly RscAddressableContract[]
): ReadonlyMap<string, string> {
  const byIdentity = new Map<string, string>();
  const identitiesById = new Map<string, string>();
  for (const contract of source) {
    const identity = {
      exportName: contract.identity.exportName,
      sourcePath: contract.identity.sourcePath,
    };
    const identityKey = createRscLogicalIdentityKey(identity);
    const label = formatRscLogicalIdentity(identity);
    if (byIdentity.has(identityKey)) {
      throw new Error(`Duplicate ${kindLabel(kind)} identity "${label}".`);
    }
    const previousIdentity = identitiesById.get(contract.id);
    if (previousIdentity !== undefined) {
      throw new Error(
        `Duplicate ${kindLabel(kind)} id "${contract.id}" for "${previousIdentity}" and "${label}".`
      );
    }
    byIdentity.set(identityKey, contract.id);
    identitiesById.set(contract.id, label);
  }
  return byIdentity;
}

function missingContractMessage(
  kind: RscClientContractKind,
  identity: RscLogicalIdentity
): string {
  const label = formatRscLogicalIdentity(identity);
  return kind === 'root'
    ? `RSC root "${label}" is missing from the generated client contract.`
    : `Server Function "${label}" is missing from the generated client contract.`;
}

function kindLabel(kind: RscClientContractKind): string {
  return kind === 'root' ? 'RSC root' : 'Server Function';
}
