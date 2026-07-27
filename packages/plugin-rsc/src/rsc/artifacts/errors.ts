export type RscArtifactErrorCode =
  | 'RSC_ARTIFACT_COORDINATE_CONFLICT'
  | 'RSC_ARTIFACT_COORDINATE_MISMATCH'
  | 'RSC_ARTIFACT_DUPLICATE_ENTRY'
  | 'RSC_ARTIFACT_INTEGRITY_MISMATCH'
  | 'RSC_ARTIFACT_INVALID_JSON'
  | 'RSC_ARTIFACT_INVALID_PATH'
  | 'RSC_ARTIFACT_INVALID_SCHEMA'
  | 'RSC_ARTIFACT_NON_CANONICAL_JSON'
  | 'RSC_ARTIFACT_UNSUPPORTED_PROTOCOL_VERSION'
  | 'RSC_ARTIFACT_UNSUPPORTED_SCHEMA_VERSION'
  | 'RSC_INVENTORY_HASH_MISMATCH'
  | 'RSC_INVENTORY_MISSING_FILE'
  | 'RSC_INVENTORY_UNEXPECTED_FILE';

export class RscArtifactError extends Error {
  readonly code: RscArtifactErrorCode;

  constructor(code: RscArtifactErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'RscArtifactError';
    this.code = code;
  }
}
