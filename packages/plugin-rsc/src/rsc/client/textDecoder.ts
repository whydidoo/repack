interface TextDecoderOptions {
  readonly fatal?: boolean;
  readonly ignoreBOM?: boolean;
}

interface TextDecodeOptions {
  readonly stream?: boolean;
}

type TextDecoderInput = ArrayBuffer | ArrayBufferView;

export function ensureRscTextDecoder(): void {
  if (typeof globalThis.TextDecoder === 'function') {
    return;
  }
  Object.defineProperty(globalThis, 'TextDecoder', {
    configurable: true,
    value: RscUtf8TextDecoder,
    writable: true,
  });
}

class RscUtf8TextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  private bomHandled = false;
  private pending = new Uint8Array();

  constructor(label = 'utf-8', options: TextDecoderOptions = {}) {
    const normalizedLabel = label.trim().toLowerCase();
    if (
      normalizedLabel !== 'utf-8' &&
      normalizedLabel !== 'utf8' &&
      normalizedLabel !== 'unicode-1-1-utf-8'
    ) {
      throw new RangeError(`Unsupported TextDecoder encoding: ${label}`);
    }
    this.fatal = options.fatal ?? false;
    this.ignoreBOM = options.ignoreBOM ?? false;
  }

  decode(input?: TextDecoderInput, options: TextDecodeOptions = {}): string {
    const incoming = input ? toBytes(input) : new Uint8Array();
    const bytes = concatBytes(this.pending, incoming);
    const output: string[] = [];
    let index = 0;
    this.pending = new Uint8Array();

    while (index < bytes.length) {
      const lead = bytes[index]!;
      const sequenceLength = getUtf8SequenceLength(lead);
      if (sequenceLength === 0) {
        this.appendReplacement(output);
        index += 1;
        continue;
      }
      if (index + sequenceLength > bytes.length) {
        if (options.stream) {
          this.pending = bytes.slice(index);
        } else {
          this.appendReplacement(output);
        }
        break;
      }

      const codePoint = decodeCodePoint(bytes, index, sequenceLength);
      if (codePoint === undefined) {
        this.appendReplacement(output);
        index += 1;
        continue;
      }
      this.appendCodePoint(output, codePoint);
      index += sequenceLength;
    }

    if (!options.stream) {
      this.pending = new Uint8Array();
      this.bomHandled = false;
    }
    return output.join('');
  }

  private appendCodePoint(output: string[], codePoint: number): void {
    if (!this.bomHandled) {
      this.bomHandled = true;
      if (codePoint === 0xfeff && !this.ignoreBOM) {
        return;
      }
    }
    output.push(String.fromCodePoint(codePoint));
  }

  private appendReplacement(output: string[]): void {
    if (this.fatal) {
      throw new TypeError('The encoded data is not valid UTF-8.');
    }
    this.appendCodePoint(output, 0xfffd);
  }
}

function toBytes(input: TextDecoderInput): Uint8Array {
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0) {
    return left;
  }
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function getUtf8SequenceLength(lead: number): number {
  if (lead <= 0x7f) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

function decodeCodePoint(
  bytes: Uint8Array,
  index: number,
  length: number
): number | undefined {
  let codePoint = bytes[index]! & (0xff >> length);
  for (let offset = 1; offset < length; offset += 1) {
    const byte = bytes[index + offset]!;
    if ((byte & 0xc0) !== 0x80) {
      return undefined;
    }
    codePoint = (codePoint << 6) | (byte & 0x3f);
  }
  const minimum =
    length === 1 ? 0 : length === 2 ? 0x80 : length === 3 ? 0x800 : 0x10000;
  if (
    codePoint < minimum ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return undefined;
  }
  return codePoint;
}
