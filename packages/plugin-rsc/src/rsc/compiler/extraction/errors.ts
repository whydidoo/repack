import type { RscSourceLocation } from '../discovery/types.js';

export type RscExtractionErrorCode =
  | 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE'
  | 'RSC_MIDDLEWARE_STATIC_LIST_REQUIRED'
  | 'RSC_ROOT_PENDING_INVALID'
  | 'RSC_ROOT_RELOAD_ON_REQUIRED'
  | 'RSC_ROOT_SHORT_FORM_REQUIRED'
  | 'RSC_SERVER_FN_HANDLER_REQUIRED';

export interface RscExtractionErrorOptions {
  readonly code: RscExtractionErrorCode;
  readonly filename: string;
  readonly location: RscSourceLocation;
  readonly message: string;
}

export class RscExtractionError extends Error {
  readonly code: RscExtractionErrorCode;
  readonly filename: string;
  readonly location: RscSourceLocation;

  constructor(options: RscExtractionErrorOptions) {
    super(options.message);
    this.name = 'RscExtractionError';
    this.code = options.code;
    this.filename = options.filename;
    this.location = options.location;
  }
}
