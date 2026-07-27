import type { Compiler } from '@rspack/core';
import { RscConfigurationError } from './configurationError.js';

interface RequestMatcher {
  readonly match: 'exact' | 'prefix';
  readonly request: string;
}

interface BuiltinPlugin {
  readonly name?: unknown;
  readonly options?: unknown;
}

const PLUGIN_NAME = 'RepackRscModuleFederationIsolationPlugin';
const protectedRequests: readonly RequestMatcher[] = [
  { match: 'exact', request: '@callstack/repack-plugin-rsc/client' },
  { match: 'prefix', request: '@callstack/repack-plugin-rsc/client/' },
  { match: 'exact', request: '@callstack/repack-plugin-rsc/runtime' },
  { match: 'prefix', request: '@callstack/repack-plugin-rsc/runtime/' },
  { match: 'exact', request: 'react-server-dom-webpack/client' },
  { match: 'prefix', request: 'react-server-dom-webpack/client.' },
  { match: 'prefix', request: 'repack:rsc/' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectEntryRequests(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return ['key', 'import', 'shareKey'].flatMap((key) =>
    typeof value[key] === 'string' ? [value[key]] : []
  );
}

function invalidBuiltinShape(name: string): never {
  throw new RscConfigurationError(
    `${PLUGIN_NAME} does not recognize the installed Rspack ${name} representation. Update @callstack/repack-plugin-rsc or use a supported Rspack version.`
  );
}

function collectBuiltinRequests(plugin: BuiltinPlugin): string[] {
  if (plugin.name === 'ConsumeSharedPlugin') {
    if (!isRecord(plugin.options) || !Array.isArray(plugin.options.consumes)) {
      return invalidBuiltinShape('ConsumeSharedPlugin');
    }
    return plugin.options.consumes.flatMap(collectEntryRequests);
  }
  if (plugin.name === 'ProvideSharedPlugin') {
    if (!Array.isArray(plugin.options)) {
      return invalidBuiltinShape('ProvideSharedPlugin');
    }
    return plugin.options.flatMap(collectEntryRequests);
  }
  return [];
}

function overlaps(left: RequestMatcher, right: RequestMatcher): boolean {
  if (left.match === 'exact' && right.match === 'exact') {
    return left.request === right.request;
  }
  if (left.match === 'prefix' && right.match === 'prefix') {
    return (
      left.request.startsWith(right.request) ||
      right.request.startsWith(left.request)
    );
  }
  const exact = left.match === 'exact' ? left.request : right.request;
  const prefix = left.match === 'prefix' ? left.request : right.request;
  return exact.startsWith(prefix);
}

function findProtectedRequest(requests: readonly string[]): string | undefined {
  for (const request of requests) {
    // Rspack treats a trailing slash as a prefix. A star remains literal.
    if (request.includes('*')) continue;
    const matcher: RequestMatcher = {
      match: request.endsWith('/') ? 'prefix' : 'exact',
      request,
    };
    if (protectedRequests.some((candidate) => overlaps(matcher, candidate))) {
      return request;
    }
  }
  return undefined;
}

/** Keep RSC client/runtime modules outside every Module Federation share scope. */
export function applyRscModuleFederationIsolation(compiler: Compiler): void {
  compiler.hooks.afterResolvers.tap(PLUGIN_NAME, () => {
    const requests = (
      compiler.__internal__builtinPlugins as readonly BuiltinPlugin[]
    ).flatMap(collectBuiltinRequests);
    const protectedRequest = findProtectedRequest(requests);
    if (!protectedRequest) return;

    throw new RscConfigurationError(
      `Module Federation cannot share "${protectedRequest}" while RscPlugin is enabled. Remove this matcher from shared so every RSC unit keeps its client and runtime modules local.`
    );
  });
}
