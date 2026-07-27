import { createRscLogicalIdentityKey } from '../identity.js';
import { RSC_PROTOCOL_VERSION } from '../protocol/requestMetadata.js';
import { canonicalJsonBytes } from './canonicalJson.js';
import { RscArtifactError } from './errors.js';
import { calculateSha256 } from './inventory.js';
import {
  createRscArtifactLayout,
  isRscDeploymentManifestPath,
  isRscPlatformManifestNamespacePath,
} from './layout.js';
import { compareStrings } from './ordering.js';
import type {
  RscAddressableContract,
  RscArtifactCoordinate,
  RscChunkReference,
  RscClientArtifact,
  RscClientReferenceContract,
  RscDeploymentManifest,
  RscPlatformManifest,
  RscSha256Integrity,
} from './types.js';

const CLIENT_ARTIFACT_SCHEMA_VERSION = 1 as const;
const DEPLOYMENT_MANIFEST_SCHEMA_VERSION = 1 as const;
const PLATFORM_MANIFEST_SCHEMA_VERSION = 1 as const;
const COORDINATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RUNTIME_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const SHA_256_INTEGRITY_PATTERN = /^sha256:[a-f0-9]{64}$/;

export type RscPlatformManifestDraft = Omit<
  RscPlatformManifest,
  'protocolVersion' | 'schemaVersion'
>;

export type RscClientArtifactDraft = Omit<
  RscClientArtifact,
  'integrity' | 'platformManifest' | 'protocolVersion' | 'schemaVersion'
> & {
  readonly platformManifest: RscPlatformManifestDraft;
};

export type RscDeploymentManifestDraft = Omit<
  RscDeploymentManifest,
  'protocolVersion' | 'schemaVersion'
>;

export interface CreatedRscArtifact<T> {
  readonly bytes: Uint8Array;
  readonly value: T;
}

function fail(
  code: ConstructorParameters<typeof RscArtifactError>[0],
  detail: string
): never {
  throw new RscArtifactError(code, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertCoordinateValue(value: unknown, field: string): string {
  const pattern =
    field === 'runtimeVersion' ? RUNTIME_VERSION_PATTERN : COORDINATE_PATTERN;
  if (typeof value !== 'string' || !pattern.test(value)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', field);
  }
  return value;
}

function assertRelativeSourcePath(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    return fail('RSC_ARTIFACT_INVALID_PATH', field);
  }

  const segments = value.split('/');
  if (
    value === '' ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.includes('\\') ||
    /^[A-Za-z]:/.test(value) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    return fail('RSC_ARTIFACT_INVALID_PATH', value);
  }
  return value;
}

function assertArtifactFilePath(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    return fail('RSC_ARTIFACT_INVALID_PATH', field);
  }

  const segments = value.slice(2).split('/');
  if (
    !value.startsWith('./') ||
    value.includes('\\') ||
    isRscDeploymentManifestPath(value) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    return fail('RSC_ARTIFACT_INVALID_PATH', value);
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', field);
  }
  return value;
}

function assertOpaqueString(value: unknown, field: string): string {
  const normalized = assertNonEmptyString(value, field);
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('file:') ||
    normalized.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(normalized)
  ) {
    return fail('RSC_ARTIFACT_INVALID_PATH', normalized);
  }
  return normalized;
}

function normalizeIdentity(
  input: unknown,
  field: string
): RscAddressableContract['identity'] {
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', field);
  }
  return {
    exportName: assertNonEmptyString(input.exportName, `${field}.exportName`),
    sourcePath: assertRelativeSourcePath(
      input.sourcePath,
      `${field}.sourcePath`
    ),
  };
}

function normalizeAddressable(
  input: unknown,
  field: string
): RscAddressableContract {
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', field);
  }
  return {
    id: assertOpaqueString(input.id, `${field}.id`),
    identity: normalizeIdentity(input.identity, `${field}.identity`),
  };
}

function normalizeChunk(input: unknown, field: string): RscChunkReference {
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', field);
  }
  if (
    !(
      typeof input.id === 'string' ||
      (typeof input.id === 'number' &&
        Number.isInteger(input.id) &&
        input.id >= 0)
    )
  ) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', `${field}.id`);
  }
  return {
    file: assertArtifactFilePath(input.file, `${field}.file`),
    id:
      typeof input.id === 'string'
        ? assertOpaqueString(input.id, `${field}.id`)
        : input.id,
  };
}

function compareChunks(
  left: RscChunkReference,
  right: RscChunkReference
): number {
  return (
    compareStrings(typeof left.id, typeof right.id) ||
    compareStrings(String(left.id), String(right.id)) ||
    compareStrings(left.file, right.file)
  );
}

function normalizeClientReference(
  input: unknown,
  field: string
): RscClientReferenceContract {
  const addressable = normalizeAddressable(input, field);
  if (!isRecord(input) || !isRecord(input.target)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', `${field}.target`);
  }
  const target = input.target;
  if (
    typeof target.async !== 'boolean' ||
    !Array.isArray(target.chunks) ||
    !(
      typeof target.moduleId === 'string' ||
      (typeof target.moduleId === 'number' &&
        Number.isInteger(target.moduleId) &&
        target.moduleId >= 0)
    )
  ) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', `${field}.target`);
  }

  return {
    ...addressable,
    target: {
      async: target.async,
      chunks: target.chunks
        .map((chunk, index) =>
          normalizeChunk(chunk, `${field}.target.chunks[${index}]`)
        )
        .sort(compareChunks),
      exportName: assertNonEmptyString(
        target.exportName,
        `${field}.target.exportName`
      ),
      moduleId:
        typeof target.moduleId === 'string'
          ? assertOpaqueString(target.moduleId, `${field}.target.moduleId`)
          : target.moduleId,
    },
  };
}

function compareAddressable(
  left: RscAddressableContract,
  right: RscAddressableContract
): number {
  return (
    compareStrings(left.id, right.id) ||
    compareStrings(left.identity.sourcePath, right.identity.sourcePath) ||
    compareStrings(left.identity.exportName, right.identity.exportName)
  );
}

function normalizeUniqueList<T extends RscAddressableContract>(
  input: unknown,
  field: string,
  normalize: (value: unknown, field: string) => T
): readonly T[] {
  if (!Array.isArray(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', field);
  }

  const normalized = input
    .map((value, index) => normalize(value, `${field}[${index}]`))
    .sort(compareAddressable);
  const duplicate = normalized.find(
    (entry, index) => index > 0 && entry.id === normalized[index - 1]?.id
  );
  if (duplicate) {
    return fail('RSC_ARTIFACT_DUPLICATE_ENTRY', `${field}:${duplicate.id}`);
  }

  const identities = new Set<string>();
  for (const entry of normalized) {
    const identity = createRscLogicalIdentityKey(entry.identity);
    if (identities.has(identity)) {
      return fail('RSC_ARTIFACT_DUPLICATE_ENTRY', `${field}:${identity}`);
    }
    identities.add(identity);
  }
  return normalized;
}

function normalizeCoordinate(input: unknown): RscArtifactCoordinate {
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'coordinate');
  }
  return {
    platform: assertCoordinateValue(input.platform, 'platform'),
    runtimeVersion: assertCoordinateValue(
      input.runtimeVersion,
      'runtimeVersion'
    ),
    unit: assertCoordinateValue(input.unit, 'unit'),
  };
}

function normalizePlatformManifest(input: unknown): RscPlatformManifestDraft {
  const coordinate = normalizeCoordinate(input);
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'platformManifest');
  }
  return {
    ...coordinate,
    clientReferences: normalizeUniqueList(
      input.clientReferences,
      'clientReferences',
      normalizeClientReference
    ),
  };
}

function normalizeClientDraft(input: unknown): RscClientArtifactDraft {
  const coordinate = normalizeCoordinate(input);
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'clientArtifact');
  }
  const platformManifest = normalizePlatformManifest(input.platformManifest);
  if (
    coordinate.unit !== platformManifest.unit ||
    coordinate.runtimeVersion !== platformManifest.runtimeVersion ||
    coordinate.platform !== platformManifest.platform
  ) {
    return fail(
      'RSC_ARTIFACT_COORDINATE_MISMATCH',
      `${coordinate.unit}/${coordinate.runtimeVersion}/${coordinate.platform}`
    );
  }

  return {
    ...coordinate,
    platformManifest,
    roots: normalizeUniqueList(input.roots, 'roots', normalizeAddressable),
    serverFunctions: normalizeUniqueList(
      input.serverFunctions,
      'serverFunctions',
      normalizeAddressable
    ),
  };
}

function createPlatformValue(
  draft: RscPlatformManifestDraft
): RscPlatformManifest {
  return {
    ...draft,
    protocolVersion: RSC_PROTOCOL_VERSION,
    schemaVersion: PLATFORM_MANIFEST_SCHEMA_VERSION,
  };
}

export function createRscPlatformManifest(
  input: RscPlatformManifestDraft
): CreatedRscArtifact<RscPlatformManifest> {
  const value = createPlatformValue(normalizePlatformManifest(input));
  return {
    bytes: canonicalJsonBytes(value),
    value,
  };
}

export function createRscClientArtifact(
  input: RscClientArtifactDraft
): CreatedRscArtifact<RscClientArtifact> {
  const draft = normalizeClientDraft(input);
  const payload = {
    ...draft,
    platformManifest: createPlatformValue(draft.platformManifest),
    protocolVersion: RSC_PROTOCOL_VERSION,
    schemaVersion: CLIENT_ARTIFACT_SCHEMA_VERSION,
  };
  const integrity = calculateSha256(canonicalJsonBytes(payload));
  const value: RscClientArtifact = {
    ...payload,
    integrity,
  };
  return {
    bytes: canonicalJsonBytes(value),
    value,
  };
}

function decodeJson(bytes: Uint8Array, detail: string): unknown {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(source);
  } catch {
    return fail('RSC_ARTIFACT_INVALID_JSON', detail);
  }
}

function assertVersions(input: Record<string, unknown>): void {
  if (input.schemaVersion !== CLIENT_ARTIFACT_SCHEMA_VERSION) {
    fail(
      'RSC_ARTIFACT_UNSUPPORTED_SCHEMA_VERSION',
      String(input.schemaVersion)
    );
  }
  if (input.protocolVersion !== RSC_PROTOCOL_VERSION) {
    fail(
      'RSC_ARTIFACT_UNSUPPORTED_PROTOCOL_VERSION',
      String(input.protocolVersion)
    );
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

export function parseRscClientArtifact(bytes: Uint8Array): RscClientArtifact {
  const input = decodeJson(bytes, 'client artifact');
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'client artifact');
  }
  assertVersions(input);

  if (
    typeof input.integrity !== 'string' ||
    !SHA_256_INTEGRITY_PATTERN.test(input.integrity)
  ) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'integrity');
  }

  const { integrity, ...payload } = input;
  if (calculateSha256(canonicalJsonBytes(payload)) !== integrity) {
    return fail('RSC_ARTIFACT_INTEGRITY_MISMATCH', 'client artifact');
  }
  if (!equalBytes(canonicalJsonBytes(input), bytes)) {
    return fail('RSC_ARTIFACT_NON_CANONICAL_JSON', 'client artifact');
  }

  if (!isRecord(input.platformManifest)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'platformManifest');
  }
  if (
    input.platformManifest.schemaVersion !== PLATFORM_MANIFEST_SCHEMA_VERSION
  ) {
    return fail(
      'RSC_ARTIFACT_UNSUPPORTED_SCHEMA_VERSION',
      `platform:${String(input.platformManifest.schemaVersion)}`
    );
  }
  if (input.platformManifest.protocolVersion !== RSC_PROTOCOL_VERSION) {
    return fail(
      'RSC_ARTIFACT_UNSUPPORTED_PROTOCOL_VERSION',
      `platform:${String(input.platformManifest.protocolVersion)}`
    );
  }

  const draft = normalizeClientDraft({
    ...payload,
    platformManifest: input.platformManifest,
  });
  const recreated = createRscClientArtifact(draft);
  if (!equalBytes(recreated.bytes, bytes)) {
    return fail('RSC_ARTIFACT_NON_CANONICAL_JSON', 'client artifact');
  }
  return recreated.value;
}

export function parseRscPlatformManifest(
  bytes: Uint8Array
): RscPlatformManifest {
  const input = decodeJson(bytes, 'platform manifest');
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'platform manifest');
  }
  if (input.schemaVersion !== PLATFORM_MANIFEST_SCHEMA_VERSION) {
    return fail(
      'RSC_ARTIFACT_UNSUPPORTED_SCHEMA_VERSION',
      String(input.schemaVersion)
    );
  }
  if (input.protocolVersion !== RSC_PROTOCOL_VERSION) {
    return fail(
      'RSC_ARTIFACT_UNSUPPORTED_PROTOCOL_VERSION',
      String(input.protocolVersion)
    );
  }

  const recreated = createRscPlatformManifest(normalizePlatformManifest(input));
  if (!equalBytes(recreated.bytes, bytes)) {
    return fail('RSC_ARTIFACT_NON_CANONICAL_JSON', 'platform manifest');
  }
  return recreated.value;
}

function normalizeDeploymentManifest(
  input: unknown
): RscDeploymentManifestDraft {
  if (!isRecord(input) || !Array.isArray(input.platforms)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'deployment manifest');
  }

  const unit = assertCoordinateValue(input.unit, 'unit');
  const runtimeVersion = assertCoordinateValue(
    input.runtimeVersion,
    'runtimeVersion'
  );
  const platforms = [
    ...new Set(
      input.platforms.map((platform) =>
        assertCoordinateValue(platform, 'platforms')
      )
    ),
  ].sort(compareStrings);
  if (platforms.length === 0) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'platforms');
  }

  if (!isRecord(input.artifacts)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'artifacts');
  }
  const artifacts = Object.fromEntries(
    Object.entries(input.artifacts)
      .map(([filePath, integrity]) => {
        const normalizedPath = assertArtifactFilePath(filePath, 'artifacts');
        if (
          typeof integrity !== 'string' ||
          !SHA_256_INTEGRITY_PATTERN.test(integrity)
        ) {
          return fail('RSC_ARTIFACT_INVALID_SCHEMA', `artifacts:${filePath}`);
        }
        return [normalizedPath, integrity as RscSha256Integrity] as const;
      })
      .sort(([left], [right]) => compareStrings(left, right))
  );
  const expectedManifestPaths = new Set<string>(
    createRscArtifactLayout({
      platforms,
      runtimeVersion,
      unit,
    }).deployment.platformManifests.map((output) => output.path.persisted)
  );
  const actualManifestPaths = Object.keys(artifacts).filter(
    isRscPlatformManifestNamespacePath
  );
  if (
    [...expectedManifestPaths].some((filePath) => !(filePath in artifacts)) ||
    actualManifestPaths.some((filePath) => !expectedManifestPaths.has(filePath))
  ) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'platform manifests');
  }
  const entry = assertArtifactFilePath(input.entry, 'entry');
  if (!(entry in artifacts)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', `entry:${entry}`);
  }

  return {
    artifacts,
    entry,
    platforms,
    runtimeVersion,
    unit,
  };
}

export function createRscDeploymentManifest(
  input: RscDeploymentManifestDraft
): CreatedRscArtifact<RscDeploymentManifest> {
  const draft = normalizeDeploymentManifest(input);
  const value: RscDeploymentManifest = {
    ...draft,
    protocolVersion: RSC_PROTOCOL_VERSION,
    schemaVersion: DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
  };
  return {
    bytes: canonicalJsonBytes(value),
    value,
  };
}

export function parseRscDeploymentManifest(
  bytes: Uint8Array
): RscDeploymentManifest {
  const input = decodeJson(bytes, 'deployment manifest');
  if (!isRecord(input)) {
    return fail('RSC_ARTIFACT_INVALID_SCHEMA', 'deployment manifest');
  }
  if (input.schemaVersion !== DEPLOYMENT_MANIFEST_SCHEMA_VERSION) {
    return fail(
      'RSC_ARTIFACT_UNSUPPORTED_SCHEMA_VERSION',
      String(input.schemaVersion)
    );
  }
  if (input.protocolVersion !== RSC_PROTOCOL_VERSION) {
    return fail(
      'RSC_ARTIFACT_UNSUPPORTED_PROTOCOL_VERSION',
      String(input.protocolVersion)
    );
  }

  const recreated = createRscDeploymentManifest(
    normalizeDeploymentManifest(input)
  );
  if (!equalBytes(recreated.bytes, bytes)) {
    return fail('RSC_ARTIFACT_NON_CANONICAL_JSON', 'deployment manifest');
  }
  return recreated.value;
}

function coordinateKey(artifact: RscClientArtifact): string {
  return JSON.stringify([
    artifact.unit,
    artifact.runtimeVersion,
    artifact.platform,
  ]);
}

export function indexRscClientArtifacts(
  files: readonly Uint8Array[]
): ReadonlyMap<string, RscClientArtifact> {
  const indexed = new Map<
    string,
    { artifact: RscClientArtifact; bytes: Uint8Array }
  >();

  for (const bytes of files) {
    const artifact = parseRscClientArtifact(bytes);
    const key = coordinateKey(artifact);
    const previous = indexed.get(key);
    if (previous && !equalBytes(previous.bytes, bytes)) {
      return fail('RSC_ARTIFACT_COORDINATE_CONFLICT', key);
    }
    if (!previous) {
      indexed.set(key, { artifact, bytes });
    }
  }

  return new Map(
    [...indexed].map(([key, value]) => [key, value.artifact] as const)
  );
}

export type { RscSha256Integrity };
