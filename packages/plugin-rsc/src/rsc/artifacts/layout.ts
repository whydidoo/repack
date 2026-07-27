import { RscArtifactError } from './errors.js';
import { compareStrings } from './ordering.js';

const DEPLOYMENT_ENTRY = 'server.js';
const DEPLOYMENT_MANIFEST = 'deployment.json';
const PACKAGE_MANIFEST = 'package.json';
const CLIENT_ARTIFACT = 'client.json';
const CLIENT_BUNDLE = 'client.bundle';
const PLATFORM_MANIFEST_DIRECTORY = 'manifests';

interface CreateRscArtifactLayoutInput {
  readonly platforms: readonly string[];
  readonly runtimeVersion: string;
  readonly unit: string;
}

interface RscPersistedArtifactPath {
  readonly bundlerRelative: string;
  readonly persisted: `./${string}`;
}

interface RscClientArtifactLayout {
  readonly artifact: string;
  readonly bundle: string;
  readonly platform: string;
}

interface RscDeploymentArtifactLayout {
  readonly entry: RscPersistedArtifactPath;
  readonly manifest: RscPersistedArtifactPath;
  readonly packageManifest: RscPersistedArtifactPath;
  readonly platformManifests: readonly {
    readonly path: RscPersistedArtifactPath;
    readonly platform: string;
  }[];
}

interface RscArtifactLayout {
  readonly clients: readonly RscClientArtifactLayout[];
  readonly deployment: RscDeploymentArtifactLayout;
}

export function createRscArtifactLayout(
  input: CreateRscArtifactLayoutInput
): RscArtifactLayout {
  assertSafeSegment(input.unit);
  assertSafeSegment(input.runtimeVersion);
  const platforms = [...input.platforms].sort(compareStrings);
  for (const platform of platforms) {
    assertSafeSegment(platform);
  }
  const duplicatePlatform = platforms.find(
    (platform, index) => index > 0 && platform === platforms[index - 1]
  );
  if (duplicatePlatform) {
    throw new RscArtifactError(
      'RSC_ARTIFACT_DUPLICATE_ENTRY',
      createPersistedPath(
        `${PLATFORM_MANIFEST_DIRECTORY}/${duplicatePlatform}.json`
      ).persisted
    );
  }

  return {
    clients: platforms.map((platform) => ({
      artifact: `rsc/${input.unit}/${input.runtimeVersion}/${platform}/${CLIENT_ARTIFACT}`,
      bundle: `rsc/${input.unit}/${input.runtimeVersion}/${platform}/${CLIENT_BUNDLE}`,
      platform,
    })),
    deployment: {
      ...getRscStaticDeploymentLayout(),
      platformManifests: platforms.map((platform) => ({
        path: createPersistedPath(
          `${PLATFORM_MANIFEST_DIRECTORY}/${platform}.json`
        ),
        platform,
      })),
    },
  };
}

export function getRscStaticDeploymentLayout(): Pick<
  RscDeploymentArtifactLayout,
  'entry' | 'manifest' | 'packageManifest'
> {
  return {
    entry: createPersistedPath(DEPLOYMENT_ENTRY),
    manifest: createPersistedPath(DEPLOYMENT_MANIFEST),
    packageManifest: createPersistedPath(PACKAGE_MANIFEST),
  };
}

export function isRscDeploymentManifestPath(filePath: string): boolean {
  return filePath === getRscStaticDeploymentLayout().manifest.persisted;
}

export function isRscClientArtifactFilename(filename: string): boolean {
  return filename === CLIENT_ARTIFACT;
}

export function isRscPlatformManifestNamespacePath(filePath: string): boolean {
  return (
    filePath.startsWith(`./${PLATFORM_MANIFEST_DIRECTORY}/`) &&
    filePath.endsWith('.json')
  );
}

function createPersistedPath(
  bundlerRelative: string
): RscPersistedArtifactPath {
  assertSafeBundlerPath(bundlerRelative);
  return {
    bundlerRelative,
    persisted: `./${bundlerRelative}` as `./${string}`,
  };
}

function assertSafeBundlerPath(filePath: string): void {
  const segments = filePath.split('/');
  if (
    filePath === '' ||
    filePath.startsWith('/') ||
    filePath.includes('\\') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    throw new RscArtifactError('RSC_ARTIFACT_INVALID_PATH', filePath);
  }
}

function assertSafeSegment(segment: string): void {
  if (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\')
  ) {
    throw new RscArtifactError('RSC_ARTIFACT_INVALID_PATH', segment);
  }
}
