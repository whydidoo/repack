import { compareStrings } from '../../artifacts/ordering.js';
import type {
  RscAddressableContract,
  RscClientArtifact,
  RscLogicalIdentity,
} from '../../artifacts/types.js';
import {
  areRscLogicalIdentitiesEqual,
  formatRscLogicalIdentity,
} from '../../identity.js';
import { createRscContractId } from '../contracts/index.js';
import type {
  RscContractIndex,
  RscIndexedContract,
  RscIndexedContractKind,
} from '../contracts/types.js';
import { RscServerArtifactValidationError } from './errors.js';

export interface ValidateRscServerArtifactsInput {
  readonly clientArtifacts: readonly RscClientArtifact[];
  readonly contractIndex: RscContractIndex;
  readonly unit: string;
}

export function validateRscServerArtifacts(
  input: ValidateRscServerArtifactsInput
): void {
  const clientReferences = input.contractIndex.contracts.filter(
    (contract) => contract.kind === 'client-reference'
  );

  for (const artifact of [...input.clientArtifacts].sort((left, right) =>
    compareStrings(left.platform, right.platform)
  )) {
    for (const contract of clientReferences) {
      const id = productionId(input.unit, contract);
      if (
        !artifact.platformManifest.clientReferences.some((reference) =>
          matchesContract(reference, id, contract.identity)
        )
      ) {
        throw new RscServerArtifactValidationError({
          code: 'RSC_SERVER_CLIENT_REFERENCE_MISSING',
          identity: contract.identity,
          message:
            `RSC server build cannot use Client Reference "${formatRscLogicalIdentity(contract.identity)}" on platform "${artifact.platform}": ` +
            'the supplied client artifact does not contain its production contract. Use the exact artifact published by the compatible mobile build.',
          platform: artifact.platform,
        });
      }
    }

    validateArtifactContracts({
      artifact,
      contracts: input.contractIndex.contracts,
      kind: 'root',
      unit: input.unit,
    });
    validateArtifactContracts({
      artifact,
      contracts: input.contractIndex.contracts,
      kind: 'server-function',
      unit: input.unit,
    });
  }
}

function validateArtifactContracts(input: {
  readonly artifact: RscClientArtifact;
  readonly contracts: readonly RscIndexedContract[];
  readonly kind: Extract<RscIndexedContractKind, 'root' | 'server-function'>;
  readonly unit: string;
}): void {
  const addressableContracts =
    input.kind === 'root'
      ? input.artifact.roots
      : input.artifact.serverFunctions;
  const currentContracts = input.contracts.filter(
    (contract) => contract.kind === input.kind
  );

  for (const addressable of addressableContracts) {
    const current = currentContracts.find((contract) =>
      matchesContract(
        addressable,
        productionId(input.unit, contract),
        contract.identity
      )
    );
    if (current) {
      continue;
    }

    const root = input.kind === 'root';
    throw new RscServerArtifactValidationError({
      code: root ? 'RSC_SERVER_ROOT_MISSING' : 'RSC_SERVER_FUNCTION_MISSING',
      identity: addressable.identity,
      message:
        `RSC client artifact for platform "${input.artifact.platform}" requires ${root ? 'root' : 'Server Function'} "${formatRscLogicalIdentity(addressable.identity)}", ` +
        'but the current server graph does not define its production contract. Build from compatible server source or preserve the published identity with a static named re-export.',
      platform: input.artifact.platform,
    });
  }
}

function productionId(unit: string, contract: RscIndexedContract): string {
  return createRscContractId({
    identity: contract.identity,
    kind: contract.kind,
    mode: 'production',
    unit,
  });
}

function matchesContract(
  candidate: RscAddressableContract,
  id: string,
  identity: RscLogicalIdentity
): boolean {
  return (
    candidate.id === id &&
    areRscLogicalIdentitiesEqual(candidate.identity, identity)
  );
}

export { RscServerArtifactValidationError } from './errors.js';
export type {
  RscServerArtifactValidationErrorCode,
  RscServerArtifactValidationErrorOptions,
} from './errors.js';
