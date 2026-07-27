import fs from 'node:fs';
import path from 'node:path';
import type { RscTransportContext } from '@callstack/repack-plugin-rsc/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRscDeployment, selectRscRelease } from '../src/rsc/catalog';
import runtime from '../src/rsc/rsc.runtime';

const context: RscTransportContext = {
  development: false,
  platform: 'ios',
  runtimeVersion: '7',
  unit: 'tester-app',
};

describe('tester RSC runtime', () => {
  afterEach(() => {
    selectRscRelease('release-a');
    vi.unstubAllGlobals();
  });

  it('uses the exact React version embedded in the React Native renderer', () => {
    const reactVersion = require('react/package.json').version;
    const reactNativeDirectory = path.dirname(
      require.resolve('react-native/package.json')
    );
    const rendererSource = fs.readFileSync(
      path.join(
        reactNativeDirectory,
        'Libraries/Renderer/implementations/ReactNativeRenderer-dev.js'
      ),
      'utf8'
    );
    const rendererVersion = rendererSource.match(
      /react-native-renderer:\s+([0-9.]+)/
    )?.[1];

    expect(rendererVersion).toBeDefined();
    expect(reactVersion).toBe(rendererVersion);
  });

  it('resolves the host-owned deployment for every request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    const transport = await runtime.createTransport(context);

    await transport.fetch({
      kind: 'render',
      init: { headers: { 'x-existing': 'kept' }, method: 'POST' },
    });
    selectRscRelease('release-b');
    await transport.fetch({ kind: 'render', init: { method: 'POST' } });

    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      'http://127.0.0.1:8082',
      'http://127.0.0.1:8083',
    ]);
    const firstHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(firstHeaders.get('x-existing')).toBe('kept');
    expect(firstHeaders.get('x-repack-rsc-validation-app')).toBe('tester-app');
  });

  it('keeps the intentionally incompatible release visible to the handshake', () => {
    selectRscRelease('incompatible');

    expect(resolveRscDeployment(context)).toMatchObject({
      endpoint: 'http://127.0.0.1:8084',
      runtimeVersion: '8',
    });
  });
});
