import type {
  RscRuntimeConfig,
  RscTransportRequest,
} from '../../runtime/index.js';
import { createRscRootClient } from '../rootClient.js';

const context = {
  development: false,
  platform: 'ios',
  runtimeVersion: '7',
  unit: 'widget',
} as const;

describe('createRscRootClient', () => {
  it('encodes a root ID and props into one transport-owned render request', async () => {
    const fetch = jest.fn<Promise<Response>, [RscTransportRequest]>(
      async () => new Response('flight')
    );
    const config: RscRuntimeConfig = {
      createTransport: () => ({ fetch }),
    };
    const encoded = new URLSearchParams([['0', 'encoded reply']]);
    const encode = jest.fn(async () => encoded);
    const decode = jest.fn(async () => 'tree');
    const client = createRscRootClient({ config, context, decode, encode });
    const props = { filters: ['active'], teamId: 'callstack' };
    const controller = new AbortController();

    const tree = await client.render({
      id: 'rsc_root_4d31',
      props,
      signal: controller.signal,
    });

    expect(tree).toEqual({ status: 'success', value: 'tree' });
    expect(decode).toHaveBeenCalledWith(expect.any(ReadableStream));
    expect(encode).toHaveBeenCalledWith(
      { id: 'rsc_root_4d31', props },
      { signal: controller.signal }
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0]![0];
    expect(request.kind).toBe('render');
    expect(request.init).toMatchObject({
      body: encoded,
      method: 'POST',
      signal: controller.signal,
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

  it('keeps FormData content type transport-defined so its boundary is preserved', async () => {
    const fetch = jest.fn<Promise<Response>, [RscTransportRequest]>(
      async () => new Response('flight')
    );
    const body = new FormData();
    body.append('0', 'encoded reply');
    const client = createRscRootClient({
      config: { createTransport: () => ({ fetch }) },
      context,
      decode: async () => 'tree',
      encode: async () => body,
    });

    await client.render({
      id: 'rsc_root_4d31',
      props: {},
      signal: new AbortController().signal,
    });

    const headers = new Headers(fetch.mock.calls[0]![0].init.headers);
    expect(headers.has('content-type')).toBe(false);
  });

  it('turns a pre-stream Problem Details response into the typed error', async () => {
    const response = new Response(
      JSON.stringify({
        code: 'RSC_INCOMPATIBLE',
        detail: 'RSC runtimeVersion is incompatible',
        expected: '8',
        reason: 'runtimeVersion',
        received: '7',
        status: 409,
        title: 'RSC compatibility error',
        type: 'about:blank',
      }),
      {
        headers: { 'content-type': 'application/problem+json' },
        status: 409,
      }
    );
    const client = createRscRootClient({
      config: {
        createTransport: () => ({ fetch: async () => response }),
      },
      context,
      decode: async () => 'tree',
      encode: async () => 'encoded reply',
    });

    await expect(
      client.render({
        id: 'rsc_root_4d31',
        props: {},
        signal: new AbortController().signal,
      })
    ).resolves.toMatchObject({
      error: {
        code: 'RSC_INCOMPATIBLE',
        expected: '8',
        reason: 'runtimeVersion',
        received: '7',
      },
      fatal: true,
      status: 'failure',
    });
  });

  it('classifies a transport failure as transient', async () => {
    const failure = new Error('Network connection lost');
    const client = createRscRootClient({
      config: {
        createTransport: () => ({
          fetch: async () => {
            throw failure;
          },
        }),
      },
      context,
      decode: async () => 'tree',
      encode: async () => 'encoded reply',
    });

    await expect(
      client.render({
        id: 'rsc_root_4d31',
        props: {},
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      error: failure,
      fatal: false,
      status: 'failure',
    });
  });
});
