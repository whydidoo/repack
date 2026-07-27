import {
  createRscProtocolRequest,
  parseRscProtocolRequest,
} from '../requestMetadata.js';

const context = {
  platform: 'ios',
  runtimeVersion: '7',
  unit: 'widget',
} as const;

describe('RSC request protocol', () => {
  it('frames a render and constructs its complete transport request', async () => {
    const signal = new AbortController().signal;
    const encoded = new URLSearchParams([['0', 'encoded reply']]);
    const encode = jest.fn(async () => encoded);

    const request = await createRscProtocolRequest(
      {
        context,
        id: 'root-1',
        kind: 'render',
        props: { team: 'callstack' },
        signal,
      },
      encode
    );

    expect(encode).toHaveBeenCalledWith(
      { id: 'root-1', props: { team: 'callstack' } },
      { signal }
    );
    expect(request).toMatchObject({
      init: { body: encoded, method: 'POST', signal },
      kind: 'render',
    });
    expect(new Headers(request.init.headers)).toEqual(
      new Headers({
        accept: 'text/x-component',
        'x-repack-rsc-kind': 'render',
        'x-repack-rsc-platform': 'ios',
        'x-repack-rsc-protocol-version': '1',
        'x-repack-rsc-runtime-version': '7',
        'x-repack-rsc-unit': 'widget',
      })
    );
  });

  it('frames an action while protecting protocol headers', async () => {
    const signal = new AbortController().signal;
    const encode = jest.fn(async () => 'encoded action');

    const request = await createRscProtocolRequest(
      {
        context,
        data: 'team-1',
        headers: {
          authorization: 'Bearer token',
          'x-repack-rsc-kind': 'render',
        },
        id: 'action-1',
        kind: 'action',
        signal,
      },
      encode
    );

    expect(encode).toHaveBeenCalledWith(
      { data: 'team-1', id: 'action-1' },
      { signal }
    );
    const headers = new Headers(request.init.headers);
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('x-repack-rsc-kind')).toBe('action');
  });

  it('parses a compatible request body through the injected Flight codec', async () => {
    const frame = { id: 'root-1', props: { team: 'callstack' } };
    const decodeReply = jest.fn(async () => frame);
    const request = createRequest('render', 'encoded root');

    await expect(
      parseRscProtocolRequest(request, {
        decodeReply,
        platforms: ['android', 'ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).resolves.toEqual({
      frame,
      kind: 'render',
      platform: 'ios',
    });
    expect(decodeReply).toHaveBeenCalledWith('encoded root', {});
  });

  it('rejects incompatible metadata before reading or decoding the body', async () => {
    const decodeReply = jest.fn();
    const request = createRequest('render', 'unused body');
    request.headers.set('x-repack-rsc-runtime-version', '6');
    const text = jest.spyOn(request, 'text');

    await expect(
      parseRscProtocolRequest(request, {
        decodeReply,
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).rejects.toMatchObject({
      expected: '7',
      message: 'RSC runtimeVersion is incompatible',
      reason: 'runtimeVersion',
      received: '6',
      status: 409,
    });
    expect(text).not.toHaveBeenCalled();
    expect(decodeReply).not.toHaveBeenCalled();
  });

  it('rejects a decoded value without an ID as the established protocol error', async () => {
    await expect(
      parseRscProtocolRequest(createRequest('action', 'invalid frame'), {
        decodeReply: async () => ({ data: 'team-1' }),
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).rejects.toMatchObject({
      code: 'RSC_PROTOCOL_ERROR',
      message: 'RSC request body is invalid.',
      status: 400,
    });
  });

  it('normalizes request body read failures as a protocol error', async () => {
    const request = createRequest('render', 'unreadable body');
    jest
      .spyOn(request, 'text')
      .mockRejectedValue(new Error('connection closed while reading'));

    await expect(
      parseRscProtocolRequest(request, {
        decodeReply: jest.fn(),
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).rejects.toMatchObject({
      code: 'RSC_PROTOCOL_ERROR',
      message: 'RSC request body is invalid.',
      status: 400,
    });
  });

  it('normalizes Flight reply decoding failures as a protocol error', async () => {
    await expect(
      parseRscProtocolRequest(createRequest('action', 'malformed reply'), {
        decodeReply: async () => {
          throw new Error('Flight decoder implementation detail');
        },
        platforms: ['ios'],
        runtimeVersion: '7',
        unit: 'widget',
      })
    ).rejects.toMatchObject({
      code: 'RSC_PROTOCOL_ERROR',
      message: 'RSC request body is invalid.',
      status: 400,
    });
  });
});

function createRequest(kind: 'action' | 'render', body: string): Request {
  return new Request('https://example.test/app-owned-rsc-path', {
    body,
    headers: {
      accept: 'text/x-component',
      'x-repack-rsc-kind': kind,
      'x-repack-rsc-platform': 'ios',
      'x-repack-rsc-protocol-version': '1',
      'x-repack-rsc-runtime-version': '7',
      'x-repack-rsc-unit': 'widget',
    },
    method: 'POST',
  });
}
