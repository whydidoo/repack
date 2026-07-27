import { canonicalJsonBytes } from '../canonicalJson.js';

const utf8 = new TextDecoder();

describe('canonicalJsonBytes', () => {
  it('sorts object keys recursively and preserves array order', () => {
    const first = {
      z: [{ b: 2, a: 1 }],
      a: true,
    };
    const second = {
      a: true,
      z: [{ a: 1, b: 2 }],
    };

    expect(canonicalJsonBytes(first)).toEqual(canonicalJsonBytes(second));
    expect(utf8.decode(canonicalJsonBytes(first))).toBe(
      '{"a":true,"z":[{"a":1,"b":2}]}'
    );
  });

  it.each([
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['negative zero', -0],
    ['bigint', BigInt(1)],
    ['date', new Date(0)],
  ])('rejects non-JSON value %s', (_name, value) => {
    expect(() => canonicalJsonBytes(value)).toThrow(
      'RSC_ARTIFACT_INVALID_JSON'
    );
  });

  it('rejects sparse arrays and cycles', () => {
    const sparse = new Array(1);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalJsonBytes(sparse)).toThrow(
      'RSC_ARTIFACT_INVALID_JSON'
    );
    expect(() => canonicalJsonBytes(cyclic)).toThrow(
      'RSC_ARTIFACT_INVALID_JSON'
    );
  });
});
