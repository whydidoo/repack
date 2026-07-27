const VALIDATION_HEADER = 'x-repack-rsc-validation-app';

export function fetchRsc(
  endpoint: string,
  init: RequestInit
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(VALIDATION_HEADER, 'tester-app');
  return globalThis.fetch(endpoint, { ...init, headers });
}
