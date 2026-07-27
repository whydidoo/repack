import { createHash } from 'node:crypto';

/** Node-only adapter for hashing the browser-safe logical identity payload. */
export function hashRscContractIdentity(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}
