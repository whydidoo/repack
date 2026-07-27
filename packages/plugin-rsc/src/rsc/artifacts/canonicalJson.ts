import { RscArtifactError } from './errors.js';
import { compareStrings } from './ordering.js';

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function invalidJson(detail: string): never {
  throw new RscArtifactError('RSC_ARTIFACT_INVALID_JSON', detail);
}

function normalizeJson(value: unknown, ancestors: WeakSet<object>): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      return invalidJson('numbers must be finite and cannot be negative zero');
    }
    return value;
  }

  if (typeof value !== 'object') {
    return invalidJson(`unsupported value type "${typeof value}"`);
  }

  if (ancestors.has(value)) {
    return invalidJson('cyclic values are not supported');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.keys(value).length !== value.length ||
        !value.every((_entry, index) =>
          Object.prototype.hasOwnProperty.call(value, index)
        )
      ) {
        return invalidJson('arrays must be dense and contain no extra keys');
      }

      return value.map((entry) => normalizeJson(entry, ancestors));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidJson('objects must have a plain prototype');
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !descriptors[key]?.enumerable ||
          descriptors[key]?.get !== undefined ||
          descriptors[key]?.set !== undefined
      )
    ) {
      return invalidJson('object properties must be enumerable data fields');
    }

    return Object.fromEntries(
      (keys as string[])
        .sort(compareStrings)
        .map((key) => [key, normalizeJson(descriptors[key]?.value, ancestors)])
    );
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  const normalized = normalizeJson(value, new WeakSet());
  return new TextEncoder().encode(JSON.stringify(normalized));
}
