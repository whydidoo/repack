import type { RscIdentityFieldValue, RscPendingPolicy } from '../rootTypes.js';
import type { RscRootRenderResult } from './rootRenderResult.js';

export interface CreateRscRootStateInput<Props, FlightTree> {
  readonly pending?: RscPendingPolicy;
  readonly render: (
    props: Props,
    signal: AbortSignal
  ) => Promise<RscRootRenderResult<FlightTree>>;
}

export type RscRootCommitResult =
  | { readonly render: 'none' }
  | {
      readonly render: 'settled' | 'urgent';
      readonly settled: Promise<void>;
    };

export interface RscRootState<Props, FlightTree> {
  commit(
    props: Props,
    identity: readonly RscIdentityFieldValue[]
  ): RscRootCommitResult;
  dispose(): void;
  read(): FlightTree;
  refresh(): Promise<void>;
}

type RootRecord<FlightTree> =
  | { readonly status: 'pending'; readonly promise: Promise<void> }
  | { readonly status: 'rejected'; readonly error: unknown }
  | { readonly status: 'resolved'; readonly value: FlightTree };

interface SuccessfulTree<FlightTree> {
  readonly identity: readonly RscIdentityFieldValue[];
  readonly value: FlightTree;
}

interface ActiveAttempt {
  readonly controller: AbortController;
  readonly reject?: (error: unknown) => void;
}

export function createRscRootState<Props extends object, FlightTree>(
  input: CreateRscRootStateInput<Props, FlightTree>
): RscRootState<Props, FlightTree> {
  const pendingPolicy = input.pending ?? 'retain';
  let activeAttempt: ActiveAttempt | undefined;
  let committedIdentity: readonly RscIdentityFieldValue[] | undefined;
  let committedProps: Props | undefined;
  let generation = 0;
  let lastSuccessful: SuccessfulTree<FlightTree> | undefined;
  let record: RootRecord<FlightTree> | undefined;

  function supersedeActiveAttempt(): void {
    const attempt = activeAttempt;
    if (!attempt) {
      return;
    }
    generation += 1;
    activeAttempt = undefined;
    attempt.controller.abort();
    attempt.reject?.(createAbortError());
  }

  function finishCurrentAttempt(renderGeneration: number): boolean {
    if (generation !== renderGeneration) {
      return false;
    }
    activeAttempt = undefined;
    return true;
  }

  function adoptSuccessfulTree(
    identity: readonly RscIdentityFieldValue[],
    value: FlightTree
  ): void {
    lastSuccessful = { identity, value };
    record = { status: 'resolved', value };
  }

  function startIdentityRender(
    props: Props,
    identity: readonly RscIdentityFieldValue[]
  ): RscRootCommitResult {
    supersedeActiveAttempt();
    const renderGeneration = ++generation;
    const controller = new AbortController();
    activeAttempt = { controller };
    const render = renderFlightTree(input, props, controller.signal);
    const settled = render.then(
      (value) => {
        if (!finishCurrentAttempt(renderGeneration)) {
          return;
        }
        adoptSuccessfulTree(identity, value);
      },
      (failure: RscRootRenderFailure) => {
        if (!finishCurrentAttempt(renderGeneration)) {
          return;
        }
        lastSuccessful = undefined;
        record = { error: failure.error, status: 'rejected' };
      }
    );
    const canRetain =
      lastSuccessful !== undefined && pendingPolicy === 'retain';
    if (!canRetain) {
      record = { promise: settled, status: 'pending' };
    }
    return {
      render: canRetain ? 'settled' : 'urgent',
      settled,
    };
  }

  return {
    commit(props, identity): RscRootCommitResult {
      const nextIdentity = validateAndSnapshotIdentity(identity);
      committedProps = props;
      if (identitiesEqual(committedIdentity, nextIdentity)) {
        return { render: 'none' };
      }

      const previousRecord = record;
      if (
        activeAttempt &&
        lastSuccessful &&
        identitiesEqual(lastSuccessful.identity, nextIdentity)
      ) {
        supersedeActiveAttempt();
        committedIdentity = nextIdentity;
        record = { status: 'resolved', value: lastSuccessful.value };
        return previousRecord?.status === 'resolved'
          ? { render: 'none' }
          : { render: 'urgent', settled: Promise.resolve() };
      }

      committedIdentity = nextIdentity;
      return startIdentityRender(props, nextIdentity);
    },

    dispose(): void {
      supersedeActiveAttempt();
    },

    read(): FlightTree {
      const currentRecord = record;
      if (!currentRecord) {
        throw new Error('Cannot read an RSC root before it is committed.');
      }
      if (currentRecord.status === 'pending') {
        throw currentRecord.promise;
      }
      if (currentRecord.status === 'rejected') {
        throw currentRecord.error;
      }
      return currentRecord.value;
    },

    refresh(): Promise<void> {
      if (committedProps === undefined || lastSuccessful === undefined) {
        return Promise.reject(
          new Error('Cannot refresh an RSC root before its initial render.')
        );
      }

      supersedeActiveAttempt();
      const props = committedProps;
      const identity = committedIdentity ?? [];
      const refreshesDisplayedIdentity = identitiesEqual(
        lastSuccessful.identity,
        identity
      );
      const renderGeneration = ++generation;
      const controller = new AbortController();
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const completion = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      activeAttempt = {
        controller,
        reject,
      };
      record = { status: 'resolved', value: lastSuccessful.value };
      void renderFlightTree(input, props, controller.signal).then(
        (value) => {
          if (!finishCurrentAttempt(renderGeneration)) {
            return;
          }
          adoptSuccessfulTree(identity, value);
          resolve();
        },
        (failure: RscRootRenderFailure) => {
          if (!finishCurrentAttempt(renderGeneration)) {
            return;
          }
          if (!refreshesDisplayedIdentity || failure.fatal) {
            lastSuccessful = undefined;
            record = { error: failure.error, status: 'rejected' };
          }
          reject(failure.error);
        }
      );
      return completion;
    },
  };
}

class RscRootRenderFailure {
  constructor(
    readonly error: unknown,
    readonly fatal: boolean
  ) {}
}

async function renderFlightTree<Props, FlightTree>(
  input: CreateRscRootStateInput<Props, FlightTree>,
  props: Props,
  signal: AbortSignal
): Promise<FlightTree> {
  try {
    const result = await input.render(props, signal);
    if (result.status === 'success') {
      return result.value;
    }
    throw new RscRootRenderFailure(result.error, result.fatal);
  } catch (error) {
    if (error instanceof RscRootRenderFailure) {
      throw error;
    }
    throw new RscRootRenderFailure(error, false);
  }
}

function validateAndSnapshotIdentity(
  identity: readonly RscIdentityFieldValue[]
): readonly RscIdentityFieldValue[] {
  const snapshot = [...identity];
  for (const part of snapshot) {
    if (!isIdentityPart(part)) {
      throw new TypeError(
        'RSC root identity must contain only primitive values.'
      );
    }
  }
  return snapshot;
}

function isIdentityPart(value: unknown): value is RscIdentityFieldValue {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  );
}

function identitiesEqual(
  previous: readonly RscIdentityFieldValue[] | undefined,
  next: readonly RscIdentityFieldValue[]
): boolean {
  return (
    previous !== undefined &&
    previous.length === next.length &&
    previous.every((part, index) => Object.is(part, next[index]))
  );
}

function createAbortError(): Error {
  const error = new Error('The RSC root request was superseded.');
  error.name = 'AbortError';
  return error;
}
