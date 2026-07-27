import { createRscClientRuntime } from '../clientRuntime.js';

const rootIdentity = {
  exportName: 'Team',
  sourcePath: 'roots/Team.rsc.tsx',
};
const actionIdentity = {
  exportName: 'checkMe',
  sourcePath: 'functions/checkMe.server.ts',
};

describe('createRscClientRuntime contract catalog', () => {
  it('reports missing roots and Server Functions with kind-aware diagnostics', () => {
    const runtime = createRuntime();

    expect(() =>
      runtime.createRscRootProxy({
        exportName: 'RemovedRoot',
        sourcePath: 'roots/Removed.rsc.tsx',
      })
    ).toThrow(
      'RSC root "roots/Removed.rsc.tsx#RemovedRoot" is missing from the generated client contract.'
    );
    expect(() =>
      runtime.createServerFnProxy({
        exportName: 'removedAction',
        sourcePath: 'functions/removedAction.server.ts',
      })
    ).toThrow(
      'Server Function "functions/removedAction.server.ts#removedAction" is missing from the generated client contract.'
    );
  });

  it.each([
    [
      'root identity',
      {
        roots: [
          { id: 'root-1', identity: rootIdentity },
          { id: 'root-2', identity: { ...rootIdentity } },
        ],
      },
      'Duplicate RSC root identity "roots/Team.rsc.tsx#Team".',
    ],
    [
      'root ID',
      {
        roots: [
          { id: 'root-1', identity: rootIdentity },
          {
            id: 'root-1',
            identity: {
              exportName: 'Account',
              sourcePath: 'roots/Account.rsc.tsx',
            },
          },
        ],
      },
      'Duplicate RSC root id "root-1" for "roots/Team.rsc.tsx#Team" and "roots/Account.rsc.tsx#Account".',
    ],
    [
      'Server Function identity',
      {
        serverFunctions: [
          { id: 'action-1', identity: actionIdentity },
          { id: 'action-2', identity: { ...actionIdentity } },
        ],
      },
      'Duplicate Server Function identity "functions/checkMe.server.ts#checkMe".',
    ],
    [
      'Server Function ID',
      {
        serverFunctions: [
          { id: 'action-1', identity: actionIdentity },
          {
            id: 'action-1',
            identity: {
              exportName: 'updateMe',
              sourcePath: 'functions/updateMe.server.ts',
            },
          },
        ],
      },
      'Duplicate Server Function id "action-1" for "functions/checkMe.server.ts#checkMe" and "functions/updateMe.server.ts#updateMe".',
    ],
  ])(
    'rejects a duplicate %s while composing the runtime',
    (_label, update, message) => {
      expect(() => createRuntime(update)).toThrow(message);
    }
  );

  it('uses the kind-aware identity and ID snapshot captured at composition', async () => {
    const root = { id: 'shared-id', identity: { ...rootIdentity } };
    const action = { id: 'shared-id', identity: { ...actionIdentity } };
    const encode = jest.fn(async () => 'encoded');
    const runtime = createRuntime({
      encode,
      roots: [root],
      serverFunctions: [action],
    });

    root.id = 'changed-root-id';
    root.identity.exportName = 'ChangedRoot';
    action.id = 'changed-action-id';
    action.identity.exportName = 'changedAction';

    expect(runtime.createRscRootProxy(rootIdentity)).toEqual(
      expect.any(Function)
    );
    const checkMe = runtime.createServerFnProxy<undefined, string>(
      actionIdentity
    );
    await expect(checkMe({ data: undefined })).resolves.toBe('result');

    expect(encode).toHaveBeenCalledWith(
      { data: undefined, id: 'shared-id' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(() => runtime.createRscRootProxy(root.identity)).toThrow(
      'RSC root "roots/Team.rsc.tsx#ChangedRoot" is missing from the generated client contract.'
    );
    expect(() => runtime.createServerFnProxy(action.identity)).toThrow(
      'Server Function "functions/checkMe.server.ts#changedAction" is missing from the generated client contract.'
    );
  });
});

function createRuntime(
  update: Partial<Parameters<typeof createRscClientRuntime>[0]> = {}
) {
  return createRscClientRuntime({
    config: {
      createTransport: () => ({
        fetch: async () => new Response('flight result'),
      }),
    },
    context: {
      development: false,
      platform: 'ios',
      runtimeVersion: '7',
      unit: 'account',
    },
    decode: async () => 'result',
    encode: async () => 'encoded',
    roots: [],
    serverFunctions: [],
    ...update,
  });
}
