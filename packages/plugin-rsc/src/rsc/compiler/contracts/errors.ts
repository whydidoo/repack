import type { RscSourceLocation } from '../discovery/types.js';

export type RscContractIndexErrorCode =
  | 'RSC_CLIENT_REFERENCE_TARGET_COLLISION'
  | 'RSC_CLIENT_REFERENCE_TARGET_MISSING'
  | 'RSC_CONTRACT_EXPORT_ALL_UNSUPPORTED'
  | 'RSC_CONTRACT_IDENTITY_COLLISION';

export interface RscContractIndexErrorOptions {
  readonly code: RscContractIndexErrorCode;
  readonly filename: string;
  readonly location: RscSourceLocation;
  readonly message: string;
}

export class RscContractIndexError extends Error {
  readonly code: RscContractIndexErrorCode;
  readonly filename: string;
  readonly location: RscSourceLocation;

  constructor(options: RscContractIndexErrorOptions) {
    super(options.message);
    this.name = 'RscContractIndexError';
    this.code = options.code;
    this.filename = options.filename;
    this.location = options.location;
  }
}
