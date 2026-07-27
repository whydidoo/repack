import { RscArtifactError } from './errors.js';
import { createRscArtifactLayout } from './layout.js';
import { compareStrings } from './ordering.js';
import type { RscClientArtifact } from './types.js';

export type RscClientArtifactPlatform = 'android' | 'ios';

export interface RscClientArtifactSet {
  readonly artifacts: readonly RscClientArtifact[];
  readonly layout: ReturnType<typeof createRscArtifactLayout>;
  readonly platforms: readonly RscClientArtifactPlatform[];
  readonly runtimeVersion: string;
  readonly unit: string;
}

/** Establish the immutable release coordinate and platform set once. */
export function createRscClientArtifactSet(
  artifacts: readonly RscClientArtifact[]
): RscClientArtifactSet {
  if (artifacts.length === 0) {
    throw new RscArtifactError('RSC_ARTIFACT_INVALID_SCHEMA', 'platforms');
  }

  const first = artifacts[0]!;
  const unit = first.unit;
  const runtimeVersion = first.runtimeVersion;
  const mismatchedArtifact = artifacts.find(
    (artifact) =>
      artifact.unit !== unit || artifact.runtimeVersion !== runtimeVersion
  );
  if (mismatchedArtifact) {
    throw new RscArtifactError(
      'RSC_ARTIFACT_COORDINATE_MISMATCH',
      `expected ${unit}@${runtimeVersion}, received ${mismatchedArtifact.unit}@${mismatchedArtifact.runtimeVersion} (${mismatchedArtifact.platform})`
    );
  }

  const clientArtifacts = [...artifacts].sort((left, right) =>
    compareStrings(left.platform, right.platform)
  );
  const platforms = clientArtifacts.map((artifact) => {
    if (artifact.platform !== 'android' && artifact.platform !== 'ios') {
      throw new RscArtifactError(
        'RSC_ARTIFACT_INVALID_SCHEMA',
        `platform:${artifact.platform}`
      );
    }
    return artifact.platform;
  });
  const layout = createRscArtifactLayout({
    platforms,
    runtimeVersion,
    unit,
  });

  return Object.freeze({
    artifacts: Object.freeze(clientArtifacts),
    layout,
    platforms: Object.freeze(platforms),
    runtimeVersion,
    unit,
  });
}
