import type { RscRootRenderResult } from '../rootRenderResult.js';
import { createRscRootState } from '../rootState.js';

describe('createRscRootState', () => {
  it('invalidates the previous tree when an identity transition fails', async () => {
    const failure = new Error('RSC server unavailable');
    const render = jest
      .fn<
        Promise<RscRootRenderResult<string>>,
        [{ teamId: string }, AbortSignal]
      >()
      .mockResolvedValueOnce(success('initial'))
      .mockResolvedValueOnce(failed(failure));
    const state = createRscRootState({ render });
    state.commit({ teamId: 'callstack' }, ['callstack']);
    await captureThrown(() => state.read());

    const commit = state.commit({ teamId: 'repack' }, ['repack']);
    if (commit.render === 'none') {
      throw new Error('Expected the identity change to start a request.');
    }
    await commit.settled;

    expect(captureThrown(() => state.read())).toBe(failure);
  });

  it('compares identity parts element by element and snapshots them', async () => {
    const render = jest.fn(async () => success('tree'));
    const state = createRscRootState({ render });
    const identity: Array<string | number> = ['team', 1];
    state.commit({ teamId: 'callstack' }, identity);
    await captureThrown(() => state.read());
    identity[1] = 2;

    expect(state.commit({ teamId: 'callstack' }, ['team', 1]).render).toBe(
      'none'
    );
    expect(state.commit({ teamId: 'callstack' }, ['team', 2]).render).toBe(
      'settled'
    );
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('rejects object identity parts before starting a render', () => {
    const render = jest.fn(async () => success('tree'));
    const state = createRscRootState({ render });

    expect(() =>
      state.commit({ teamId: 'callstack' }, ['team', {}] as never)
    ).toThrow('RSC root identity must contain only primitive values.');
    expect(render).not.toHaveBeenCalled();
  });

  it('throws an initial render failure for an Error Boundary', async () => {
    const failure = new Error('RSC server unavailable');
    const state = createRscRootState({
      render: async () => failed(failure),
    });
    const props = { teamId: 'callstack' };
    state.commit(props, ['team']);

    await captureThrown(() => state.read());

    expect(captureThrown(() => state.read())).toBe(failure);
  });

  it('captures a synchronous request failure in the same Suspense lifecycle', async () => {
    const failure = new Error('Failed to encode root props');
    const state = createRscRootState({
      render: () => {
        throw failure;
      },
    });
    const props = { teamId: 'callstack' };
    state.commit(props, ['team']);

    const suspended = captureThrown(() => state.read());

    expect(suspended).toBeInstanceOf(Promise);
    await suspended;
    expect(captureThrown(() => state.read())).toBe(failure);
  });

  it('rejects a transient refresh failure without deleting successful UI', async () => {
    const failure = new Error('Network unavailable');
    const render = jest
      .fn<
        Promise<RscRootRenderResult<string>>,
        [{ teamId: string }, AbortSignal]
      >()
      .mockResolvedValueOnce(success('initial'))
      .mockResolvedValueOnce(failed(failure));
    const state = createRscRootState({ render });
    const props = { teamId: 'callstack' };
    state.commit(props, ['team']);
    await captureThrown(() => state.read());

    await expect(state.refresh()).rejects.toBe(failure);

    expect(state.read()).toBe('initial');
  });

  it('invalidates successful UI after a fatal refresh failure', async () => {
    const failure = new Error('RSC runtime is incompatible');
    const render = jest
      .fn<
        Promise<RscRootRenderResult<string>>,
        [{ teamId: string }, AbortSignal]
      >()
      .mockResolvedValueOnce(success('initial'))
      .mockResolvedValueOnce(failed(failure, true));
    const state = createRscRootState({ render });
    const props = { teamId: 'callstack' };
    state.commit(props, ['team']);
    await captureThrown(() => state.read());

    await expect(state.refresh()).rejects.toBe(failure);

    expect(captureThrown(() => state.read())).toBe(failure);
  });

  it('invalidates the displayed tree when a refresh during an identity transition fails', async () => {
    const transition = deferred<RscRootRenderResult<string>>();
    const failure = new Error('Network unavailable');
    const render = jest
      .fn<
        Promise<RscRootRenderResult<string>>,
        [{ teamId: string }, AbortSignal]
      >()
      .mockResolvedValueOnce(success('initial'))
      .mockReturnValueOnce(transition.promise)
      .mockResolvedValueOnce(failed(failure));
    const state = createRscRootState({ render });
    state.commit({ teamId: 'callstack' }, ['callstack']);
    await captureThrown(() => state.read());
    state.commit({ teamId: 'repack' }, ['repack']);

    await expect(state.refresh()).rejects.toBe(failure);

    expect(captureThrown(() => state.read())).toBe(failure);
  });
});

function success<Value>(value: Value): RscRootRenderResult<Value> {
  return { status: 'success', value };
}

function failed(error: unknown, fatal = false): RscRootRenderResult<never> {
  return { error, fatal, status: 'failure' };
}

function captureThrown(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
