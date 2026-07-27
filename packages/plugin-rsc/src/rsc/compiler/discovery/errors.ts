import type { RscSourceLocation } from './types.js';

export type RscDiscoveryErrorCode =
  | 'RSC_DECLARATION_DEFAULT_EXPORT'
  | 'RSC_DECLARATION_DYNAMIC'
  | 'RSC_DECLARATION_NOT_CONST'
  | 'RSC_DECLARATION_NOT_EXPORTED'
  | 'RSC_DECLARATION_NOT_NAMED'
  | 'RSC_DECLARATION_NOT_TOP_LEVEL'
  | 'RSC_USE_SERVER_UNSUPPORTED';

export interface RscDiscoveryErrorOptions {
  readonly code: RscDiscoveryErrorCode;
  readonly filename: string;
  readonly location: RscSourceLocation;
  readonly message: string;
}

export class RscDiscoveryError extends Error {
  readonly code: RscDiscoveryErrorCode;
  readonly filename: string;
  readonly location: RscSourceLocation;

  constructor(options: RscDiscoveryErrorOptions) {
    super(options.message);
    this.name = 'RscDiscoveryError';
    this.code = options.code;
    this.filename = options.filename;
    this.location = options.location;
  }
}
