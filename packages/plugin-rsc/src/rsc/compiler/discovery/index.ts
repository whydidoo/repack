import { analyzeRscModule } from '../parseRscModule.js';
import type {
  DiscoverRscDeclarationsInput,
  RscDiscoveryResult,
} from './types.js';

export function discoverRscDeclarations(
  input: DiscoverRscDeclarationsInput
): RscDiscoveryResult {
  return analyzeRscModule(input.source, input.filename).discovery;
}

export type {
  DiscoverRscDeclarationsInput,
  RscDeclaration,
  RscDeclarationKind,
  RscMiddlewareDeclaration,
  RscDiscoveryResult,
  RscRootDeclaration,
  RscServerFunctionDeclaration,
  RscSourceLocation,
} from './types.js';
export { RscDiscoveryError } from './errors.js';
export type {
  RscDiscoveryErrorCode,
  RscDiscoveryErrorOptions,
} from './errors.js';
