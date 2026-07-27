import { ensureRscTextDecoder } from '../textDecoder.js';

describe('ensureRscTextDecoder', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextDecoder');

  afterEach(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, 'TextDecoder', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'TextDecoder');
    }
  });

  it('installs a streaming UTF-8 decoder when the host has none', () => {
    Reflect.deleteProperty(globalThis, 'TextDecoder');
    ensureRscTextDecoder();
    const decoder = new TextDecoder();

    expect(decoder.decode(Uint8Array.from([0xe2]), { stream: true })).toBe('');
    expect(
      decoder.decode(Uint8Array.from([0x82, 0xac, 0x20]), { stream: true })
    ).toBe('€ ');
    expect(decoder.decode(Uint8Array.from([0xf0, 0x9f, 0x98, 0x80]))).toBe(
      '😀'
    );
  });

  it('preserves the host TextDecoder', () => {
    const HostTextDecoder = class {
      decode() {
        return 'host';
      }
    };
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      value: HostTextDecoder,
    });

    ensureRscTextDecoder();

    expect(new TextDecoder().decode()).toBe('host');
  });

  it('supports replacement and fatal decoding modes', () => {
    Reflect.deleteProperty(globalThis, 'TextDecoder');
    ensureRscTextDecoder();

    expect(new TextDecoder().decode(Uint8Array.from([0xff]))).toBe('�');
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from([0xff]))
    ).toThrow('The encoded data is not valid UTF-8.');
  });
});
