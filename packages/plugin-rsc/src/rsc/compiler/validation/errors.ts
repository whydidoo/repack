import type { RscLogicalIdentity } from '../../artifacts/types.js';

export type RscServerArtifactValidationErrorCode =
  | 'RSC_SERVER_CLIENT_REFERENCE_MISSING'
  | 'RSC_SERVER_FUNCTION_MISSING'
  | 'RSC_SERVER_ROOT_MISSING';

export interface RscServerArtifactValidationErrorOptions {
  readonly code: RscServerArtifactValidationErrorCode;
  readonly identity: RscLogicalIdentity;
  readonly message: string;
  readonly platform: string;
}

export class RscServerArtifactValidationError extends Error {
  readonly code: RscServerArtifactValidationErrorCode;
  readonly identity: RscLogicalIdentity;
  readonly platform: string;

  constructor(options: RscServerArtifactValidationErrorOptions) {
    super(options.message);
    this.name = 'RscServerArtifactValidationError';
    this.code = options.code;
    this.identity = options.identity;
    this.platform = options.platform;
  }
}
