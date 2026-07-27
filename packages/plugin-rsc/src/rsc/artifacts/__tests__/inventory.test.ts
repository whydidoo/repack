import {
  calculateSha256,
  createSha256Inventory,
  verifySha256Inventory,
} from '../inventory.js';

const utf8 = new TextEncoder();

describe('RSC artifact inventory', () => {
  it('calculates stable SHA-256 integrity values', () => {
    expect(calculateSha256(new Uint8Array())).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(calculateSha256(utf8.encode('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('creates a deterministic inventory independent of input order', () => {
    const files = [
      {
        bytes: utf8.encode('ios'),
        path: './manifests/ios.json',
      },
      {
        bytes: utf8.encode('server'),
        path: './server.js',
      },
    ];

    expect(createSha256Inventory(files)).toEqual(
      createSha256Inventory([...files].reverse())
    );
    expect(Object.keys(createSha256Inventory(files))).toEqual([
      './manifests/ios.json',
      './server.js',
    ]);
  });

  it('detects a one-byte modification', () => {
    const inventory = createSha256Inventory([
      {
        bytes: utf8.encode('server'),
        path: './server.js',
      },
    ]);

    expect(() =>
      verifySha256Inventory(inventory, [
        {
          bytes: utf8.encode('Server'),
          path: './server.js',
        },
      ])
    ).toThrow('RSC_INVENTORY_HASH_MISMATCH: ./server.js');
  });

  it.each([
    '/absolute/server.js',
    '../server.js',
    './manifests/../server.js',
    '.\\server.js',
    './deployment.json',
  ])('rejects unsafe or recursive inventory path %s', (unsafePath) => {
    expect(() =>
      createSha256Inventory([
        {
          bytes: new Uint8Array(),
          path: unsafePath,
        },
      ])
    ).toThrow(`RSC_ARTIFACT_INVALID_PATH: ${unsafePath}`);
  });
});
