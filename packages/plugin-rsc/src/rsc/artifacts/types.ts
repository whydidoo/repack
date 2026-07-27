export type RscSha256Integrity = `sha256:${string}`;

export interface RscArtifactCoordinate {
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly unit: string;
}

export interface RscLogicalIdentity {
  readonly exportName: string;
  readonly sourcePath: string;
}

export interface RscAddressableContract {
  readonly id: string;
  readonly identity: RscLogicalIdentity;
}

export interface RscChunkReference {
  readonly file: string;
  readonly id: number | string;
}

export interface RscClientReferenceContract extends RscAddressableContract {
  readonly target: {
    readonly async: boolean;
    readonly chunks: readonly RscChunkReference[];
    readonly exportName: string;
    readonly moduleId: number | string;
  };
}

export interface RscPlatformManifest extends RscArtifactCoordinate {
  readonly clientReferences: readonly RscClientReferenceContract[];
  readonly protocolVersion: 1;
  readonly schemaVersion: 1;
}

export interface RscClientArtifact extends RscArtifactCoordinate {
  readonly integrity: RscSha256Integrity;
  readonly platformManifest: RscPlatformManifest;
  readonly protocolVersion: 1;
  readonly roots: readonly RscAddressableContract[];
  readonly schemaVersion: 1;
  readonly serverFunctions: readonly RscAddressableContract[];
}

export interface RscDeploymentManifest {
  readonly artifacts: RscArtifactInventory;
  readonly entry: string;
  readonly platforms: readonly string[];
  readonly protocolVersion: 1;
  readonly runtimeVersion: string;
  readonly schemaVersion: 1;
  readonly unit: string;
}

export interface RscInventoryFile {
  readonly bytes: Uint8Array;
  readonly path: string;
}

export type RscArtifactInventory = Readonly<Record<string, RscSha256Integrity>>;
