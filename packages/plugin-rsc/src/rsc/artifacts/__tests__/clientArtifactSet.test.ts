import { createRscClientArtifactSet } from '../clientArtifactSet.js';
import { createRscClientArtifact } from '../index.js';

describe('createRscClientArtifactSet', () => {
  it('establishes one canonical coordinate and sorted platform set', () => {
    const ios = artifact('ios');
    const android = artifact('android');

    const result = createRscClientArtifactSet([ios, android]);

    expect(result).toMatchObject({
      artifacts: [android, ios],
      platforms: ['android', 'ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });
    expect(result.layout.deployment.platformManifests).toMatchObject([
      { platform: 'android' },
      { platform: 'ios' },
    ]);
  });

  it('rejects empty, mixed-coordinate, duplicate and unsupported sets', () => {
    expect(() => createRscClientArtifactSet([])).toThrow(
      'RSC_ARTIFACT_INVALID_SCHEMA: platforms'
    );
    expect(() =>
      createRscClientArtifactSet([
        artifact('ios'),
        artifact('android', { runtimeVersion: '8', unit: 'widget' }),
      ])
    ).toThrow(
      'RSC_ARTIFACT_COORDINATE_MISMATCH: expected widget@7, received widget@8 (android)'
    );
    const ios = artifact('ios');
    expect(() => createRscClientArtifactSet([ios, ios])).toThrow(
      'RSC_ARTIFACT_DUPLICATE_ENTRY: ./manifests/ios.json'
    );
    expect(() => createRscClientArtifactSet([artifact('web')])).toThrow(
      'RSC_ARTIFACT_INVALID_SCHEMA: platform:web'
    );
  });
});

function artifact(
  platform: string,
  coordinate: { readonly runtimeVersion: string; readonly unit: string } = {
    runtimeVersion: '7',
    unit: 'widget',
  }
) {
  return createRscClientArtifact({
    platform,
    platformManifest: {
      clientReferences: [],
      platform,
      runtimeVersion: coordinate.runtimeVersion,
      unit: coordinate.unit,
    },
    roots: [],
    runtimeVersion: coordinate.runtimeVersion,
    serverFunctions: [],
    unit: coordinate.unit,
  }).value;
}
