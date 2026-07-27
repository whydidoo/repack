import { canonicalJsonBytes } from '../canonicalJson.js';
import {
  createRscClientArtifact,
  createRscDeploymentManifest,
  createRscPlatformManifest,
  indexRscClientArtifacts,
  parseRscClientArtifact,
  parseRscDeploymentManifest,
  parseRscPlatformManifest,
} from '../index.js';
import type { RscClientArtifactDraft } from '../index.js';

function createDraft(): RscClientArtifactDraft {
  return {
    platform: 'ios',
    platformManifest: {
      clientReferences: [
        {
          id: 'client-b',
          identity: {
            exportName: 'Beta',
            sourcePath: 'components/Beta.tsx',
          },
          target: {
            async: false,
            chunks: [
              { file: './chunks/z.js', id: 2 },
              { file: './chunks/a.js', id: 1 },
            ],
            exportName: 'Beta',
            moduleId: 42,
          },
        },
        {
          id: 'client-a',
          identity: {
            exportName: 'Alpha',
            sourcePath: 'components/Alpha.tsx',
          },
          target: {
            async: true,
            chunks: [],
            exportName: 'Alpha',
            moduleId: 'alpha',
          },
        },
      ],
      platform: 'ios',
      runtimeVersion: '7',
      unit: 'widget',
    },
    roots: [
      {
        id: 'root-b',
        identity: {
          exportName: 'Beta',
          sourcePath: 'roots/Beta.tsx',
        },
      },
      {
        id: 'root-a',
        identity: {
          exportName: 'Alpha',
          sourcePath: 'roots/Alpha.tsx',
        },
      },
    ],
    runtimeVersion: '7',
    serverFunctions: [
      {
        id: 'action-a',
        identity: {
          exportName: 'checkMe',
          sourcePath: 'actions/checkMe.ts',
        },
      },
    ],
    unit: 'widget',
  };
}

describe('RSC client artifacts', () => {
  it('creates deterministic bytes and parses the immutable artifact', () => {
    const first = createRscClientArtifact(createDraft());
    const source = createDraft();
    const permuted: RscClientArtifactDraft = {
      ...source,
      platformManifest: {
        ...source.platformManifest,
        clientReferences: [...source.platformManifest.clientReferences]
          .reverse()
          .map((reference) => ({
            ...reference,
            target: {
              ...reference.target,
              chunks: [...reference.target.chunks].reverse(),
            },
          })),
      },
      roots: [...source.roots].reverse(),
    };
    const second = createRscClientArtifact(permuted);

    expect(first.bytes).toEqual(second.bytes);
    expect(parseRscClientArtifact(first.bytes)).toEqual(first.value);
  });

  it('rejects absolute source paths before serialization', () => {
    const source = createDraft();
    const draft: RscClientArtifactDraft = {
      ...source,
      roots: source.roots.map((root, index) =>
        index === 0
          ? {
              ...root,
              identity: {
                ...root.identity,
                sourcePath: '/Users/example/roots/Beta.tsx',
              },
            }
          : root
      ),
    };

    expect(() => createRscClientArtifact(draft)).toThrow(
      'RSC_ARTIFACT_INVALID_PATH'
    );
  });

  it.each([
    {
      field: 'wire id',
      update: (draft: RscClientArtifactDraft): RscClientArtifactDraft => ({
        ...draft,
        roots: draft.roots.map((root, index) =>
          index === 0 ? { ...root, id: 'file:///Users/example/root' } : root
        ),
      }),
    },
    {
      field: 'module id',
      update: (draft: RscClientArtifactDraft): RscClientArtifactDraft => ({
        ...draft,
        platformManifest: {
          ...draft.platformManifest,
          clientReferences: draft.platformManifest.clientReferences.map(
            (reference, index) =>
              index === 0
                ? {
                    ...reference,
                    target: {
                      ...reference.target,
                      moduleId: '/Users/example/module.tsx',
                    },
                  }
                : reference
          ),
        },
      }),
    },
    {
      field: 'chunk id',
      update: (draft: RscClientArtifactDraft): RscClientArtifactDraft => ({
        ...draft,
        platformManifest: {
          ...draft.platformManifest,
          clientReferences: draft.platformManifest.clientReferences.map(
            (reference, index) =>
              index === 0
                ? {
                    ...reference,
                    target: {
                      ...reference.target,
                      chunks: [
                        {
                          file: './chunks/a.js',
                          id: 'C:\\Users\\example\\chunk.js',
                        },
                      ],
                    },
                  }
                : reference
          ),
        },
      }),
    },
  ])('rejects an absolute local path used as $field', ({ update }) => {
    expect(() => createRscClientArtifact(update(createDraft()))).toThrow(
      'RSC_ARTIFACT_INVALID_PATH'
    );
  });

  it('rejects two wire IDs for one logical identity', () => {
    const source = createDraft();
    const duplicateIdentity: RscClientArtifactDraft = {
      ...source,
      roots: [
        ...source.roots,
        {
          id: 'root-alias',
          identity: source.roots[0]!.identity,
        },
      ],
    };

    expect(() => createRscClientArtifact(duplicateIdentity)).toThrow(
      'RSC_ARTIFACT_DUPLICATE_ENTRY'
    );
  });

  it('validates schema and protocol versions independently', () => {
    const { bytes } = createRscClientArtifact(createDraft());
    const value = JSON.parse(new TextDecoder().decode(bytes));

    expect(() =>
      parseRscClientArtifact(
        canonicalJsonBytes({
          ...value,
          schemaVersion: 2,
        })
      )
    ).toThrow('RSC_ARTIFACT_UNSUPPORTED_SCHEMA_VERSION');

    expect(() =>
      parseRscClientArtifact(
        canonicalJsonBytes({
          ...value,
          protocolVersion: 2,
        })
      )
    ).toThrow('RSC_ARTIFACT_UNSUPPORTED_PROTOCOL_VERSION');
  });

  it('detects a one-byte artifact modification', () => {
    const { bytes } = createRscClientArtifact(createDraft());
    const modified = new TextEncoder().encode(
      new TextDecoder().decode(bytes).replace('"widget"', '"Widget"')
    );

    expect(() => parseRscClientArtifact(modified)).toThrow(
      'RSC_ARTIFACT_INTEGRITY_MISMATCH'
    );
  });

  it('rejects different content under one immutable coordinate', () => {
    const first = createRscClientArtifact(createDraft());
    const source = createDraft();
    const changedDraft: RscClientArtifactDraft = {
      ...source,
      roots: source.roots.map((root, index) =>
        index === 0
          ? {
              ...root,
              identity: {
                ...root.identity,
                exportName: 'ChangedBeta',
              },
            }
          : root
      ),
    };
    const changed = createRscClientArtifact(changedDraft);

    expect(() => indexRscClientArtifacts([first.bytes, changed.bytes])).toThrow(
      'RSC_ARTIFACT_COORDINATE_CONFLICT'
    );
    expect(indexRscClientArtifacts([first.bytes, first.bytes]).size).toBe(1);
  });
});

describe('RSC release manifests', () => {
  it('creates independently parseable platform and deployment manifests', () => {
    const platform = createRscPlatformManifest(createDraft().platformManifest);
    expect(parseRscPlatformManifest(platform.bytes)).toEqual(platform.value);

    const deployment = createRscDeploymentManifest({
      artifacts: {
        './manifests/android.json':
          'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        './server.js':
          'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        './manifests/ios.json':
          'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      },
      entry: './server.js',
      platforms: ['ios', 'android', 'ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });

    expect(deployment.value.platforms).toEqual(['android', 'ios']);
    expect(parseRscDeploymentManifest(deployment.bytes)).toEqual(
      deployment.value
    );
  });

  it('keeps deployment schema and protocol validation independent', () => {
    const created = createRscDeploymentManifest({
      artifacts: {
        './manifests/ios.json':
          'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        './server.js':
          'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      entry: './server.js',
      platforms: ['ios'],
      runtimeVersion: '7',
      unit: 'widget',
    });
    const value = JSON.parse(new TextDecoder().decode(created.bytes));

    expect(() =>
      parseRscDeploymentManifest(
        canonicalJsonBytes({ ...value, schemaVersion: 2 })
      )
    ).toThrow('RSC_ARTIFACT_UNSUPPORTED_SCHEMA_VERSION');
    expect(() =>
      parseRscDeploymentManifest(
        canonicalJsonBytes({ ...value, protocolVersion: 2 })
      )
    ).toThrow('RSC_ARTIFACT_UNSUPPORTED_PROTOCOL_VERSION');
  });

  it('requires an exact platform-to-manifest inventory mapping', () => {
    const integrity =
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    expect(() =>
      createRscDeploymentManifest({
        artifacts: {
          './server.js': integrity,
        },
        entry: './server.js',
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_ARTIFACT_INVALID_SCHEMA');

    expect(() =>
      createRscDeploymentManifest({
        artifacts: {
          './manifests/android.json': integrity,
          './manifests/ios.json': integrity,
          './server.js': integrity,
        },
        entry: './server.js',
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_ARTIFACT_INVALID_SCHEMA');

    expect(() =>
      createRscDeploymentManifest({
        artifacts: {
          './manifests/ios.json': integrity,
          './manifests/nested/ios.json': integrity,
          './server.js': integrity,
        },
        entry: './server.js',
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).toThrow('RSC_ARTIFACT_INVALID_SCHEMA');
  });
});
