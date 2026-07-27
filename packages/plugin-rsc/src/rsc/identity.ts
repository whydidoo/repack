import type { RscLogicalIdentity } from './artifacts/types.js';

/** Canonical in-process key for one logical RSC identity. */
export function createRscLogicalIdentityKey(
  identity: RscLogicalIdentity
): string {
  return JSON.stringify([identity.sourcePath, identity.exportName]);
}

export function areRscLogicalIdentitiesEqual(
  left: RscLogicalIdentity,
  right: RscLogicalIdentity
): boolean {
  return (
    left.sourcePath === right.sourcePath && left.exportName === right.exportName
  );
}

/** Canonical compatibility payload hashed into a production wire ID. */
export function createRscContractIdentityPayload(input: {
  readonly identity: RscLogicalIdentity;
  readonly kind: string;
  readonly unit: string;
}): string {
  return JSON.stringify([
    input.unit,
    input.kind,
    input.identity.sourcePath,
    input.identity.exportName,
  ]);
}

export function createRscContractSnapshotKey(input: {
  readonly identity: RscLogicalIdentity;
  readonly kind: string;
  readonly target: RscLogicalIdentity;
}): string {
  return JSON.stringify([
    input.kind,
    input.identity.sourcePath,
    input.identity.exportName,
    input.target.sourcePath,
    input.target.exportName,
  ]);
}

export function formatRscLogicalIdentity(identity: RscLogicalIdentity): string {
  return `${identity.sourcePath}#${identity.exportName}`;
}

export function formatRscContractLabel(
  kind: string,
  identity: RscLogicalIdentity
): string {
  return `${kind} ${formatRscLogicalIdentity(identity)}`;
}
