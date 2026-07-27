import { createRscArtifactLayout } from '../layout.js';

describe('RSC persisted artifact layout', () => {
  it('returns one deterministic canonical layout for client and deployment artifacts', () => {
    expect(
      createRscArtifactLayout({
        platforms: ['ios', 'android'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toEqual({
      clients: [
        {
          artifact: 'rsc/widget/7/android/client.json',
          bundle: 'rsc/widget/7/android/client.bundle',
          platform: 'android',
        },
        {
          artifact: 'rsc/widget/7/ios/client.json',
          bundle: 'rsc/widget/7/ios/client.bundle',
          platform: 'ios',
        },
      ],
      deployment: {
        entry: {
          bundlerRelative: 'server.js',
          persisted: './server.js',
        },
        manifest: {
          bundlerRelative: 'deployment.json',
          persisted: './deployment.json',
        },
        packageManifest: {
          bundlerRelative: 'package.json',
          persisted: './package.json',
        },
        platformManifests: [
          {
            path: {
              bundlerRelative: 'manifests/android.json',
              persisted: './manifests/android.json',
            },
            platform: 'android',
          },
          {
            path: {
              bundlerRelative: 'manifests/ios.json',
              persisted: './manifests/ios.json',
            },
            platform: 'ios',
          },
        ],
      },
    });
  });

  it.each([
    { field: 'unit', value: '/absolute' },
    { field: 'unit', value: 'widget\\nested' },
    { field: 'runtimeVersion', value: '..' },
    { field: 'runtimeVersion', value: 'release/next' },
    { field: 'platform', value: '../ios' },
    { field: 'platform', value: 'C:\\ios' },
  ] as const)('rejects unsafe $field segment "$value"', ({ field, value }) => {
    expect(() =>
      createRscArtifactLayout({
        platforms: [field === 'platform' ? value : 'ios'],
        runtimeVersion: field === 'runtimeVersion' ? value : '7',
        unit: field === 'unit' ? value : 'widget',
      })
    ).toThrow(`RSC_ARTIFACT_INVALID_PATH: ${value}`);
  });

  it('rejects platform path collisions', () => {
    expect(() =>
      createRscArtifactLayout({
        platforms: ['ios', 'ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_ARTIFACT_DUPLICATE_ENTRY: ./manifests/ios.json');
  });
});
