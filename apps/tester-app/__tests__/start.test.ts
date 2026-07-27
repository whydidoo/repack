import fs from 'node:fs';
import path from 'node:path';
import rspackCommands from '@callstack/repack/commands/rspack';
import webpackCommands from '@callstack/repack/commands/webpack';
import getPort from 'get-port';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let port: number;
let stopServer: () => Promise<void>;

describe('start command', () => {
  describe.each([
    {
      bundler: 'webpack',
      commands: webpackCommands,
      configFile: './webpack.config.mjs',
    },
    {
      bundler: 'rspack',
      commands: rspackCommands,
      configFile: './rspack.config.mjs',
    },
  ])('using $bundler', ({ bundler, commands, configFile }) => {
    const startCommand = commands.find((command) => command.name === 'start');
    if (!startCommand) throw new Error('start command not found');

    it("should be also available under 'webpack-start' alias", () => {
      const webpackStartCommand = commands.find(
        (command) => command.name === 'webpack-start'
      );

      expect(webpackStartCommand).toBeDefined();
      const { description, func, options } = webpackStartCommand!;

      expect(startCommand.description).toEqual(description);
      expect(startCommand.options).toEqual(options);
      expect(startCommand.func).toEqual(func);
    });

    describe.each([
      {
        platform: 'ios',
        requests: [
          'index.bundle?platform=ios',
          'index.bundle.map?platform=ios',
          'ios/miniapp.chunk.bundle',
          'ios/miniapp.chunk.bundle.map',
          'ios/remote.chunk.bundle',
          'ios/remote.chunk.bundle.map',
          'ios/src_asyncChunks_Async_local_tsx.chunk.bundle',
          'ios/src_asyncChunks_Async_local_tsx.chunk.bundle.map',
          'assets/src/miniapp/callstack-dark.png?platform=ios',
          'remote-assets/assets/src/assetsTest/remoteAssets/webpack.png?platform=ios',
          'remote-assets/assets/src/assetsTest/remoteAssets/webpack@2x.png?platform=ios',
          'remote-assets/assets/src/assetsTest/remoteAssets/webpack@3x.png?platform=ios',
          'index.js',
          'src/App.tsx',
          'src/ui/undraw_Developer_activity_re_39tg.svg',
        ],
      },
      {
        platform: 'android',
        requests: [
          'index.bundle?platform=android',
          'index.bundle.map?platform=android',
          'android/miniapp.chunk.bundle',
          'android/miniapp.chunk.bundle.map',
          'android/remote.chunk.bundle',
          'android/remote.chunk.bundle.map',
          'android/src_asyncChunks_Async_local_tsx.chunk.bundle',
          'android/src_asyncChunks_Async_local_tsx.chunk.bundle.map',
          'assets/src/miniapp/callstack-dark.png?platform=android',
          'remote-assets/assets/src/assetsTest/remoteAssets/webpack.png?platform=android',
          'remote-assets/assets/src/assetsTest/remoteAssets/webpack@2x.png?platform=android',
          'remote-assets/assets/src/assetsTest/remoteAssets/webpack@3x.png?platform=android',
          'index.js',
          'src/App.tsx',
          'src/ui/undraw_Developer_activity_re_39tg.svg',
        ],
      },
    ])(
      'should successfully produce bundle assets',
      ({ platform, requests }) => {
        const TMP_DIR = path.join(
          __dirname,
          `out/start/${bundler}/${platform}`
        );

        beforeAll(async () => {
          await fs.promises.rm(TMP_DIR, {
            recursive: true,
            force: true,
          });

          port = await getPort();

          const config = {
            root: path.join(__dirname, '..'),
            platforms: { ios: {}, android: {} },
            reactNativePath: path.join(
              __dirname,
              '../node_modules/react-native'
            ),
          };

          const args = {
            port,
            platform,
            logFile: path.join(TMP_DIR, 'server.log'),
            webpackConfig: path.join(__dirname, 'configs', configFile),
          };

          // @ts-ignore
          const { stop } = await startCommand.func([], config, args);
          stopServer = stop;
        });

        afterAll(async () => {
          await stopServer();
        });

        it(
          `for ${platform}`,
          async () => {
            let response = await fetch(`http://localhost:${port}/`);
            await expect(response.text()).resolves.toEqual(
              'React Native packager is running'
            );

            const [bundleRequest, ...assetsRequests] = requests;

            response = await fetch(`http://localhost:${port}/${bundleRequest}`);

            const responseText = await response.text();
            if (responseText.length < 100000) {
              console.log(response, responseText);
            }
            expect(responseText.length).toBeGreaterThan(100000);

            if (bundler === 'rspack') {
              await expectRscRenderAndAction({ platform, port });
            }

            const responses = await Promise.all(
              assetsRequests.map((asset) =>
                fetch(`http://localhost:${port}/${asset}`)
              )
            );

            responses.forEach((response) => {
              if (!response.ok) {
                console.log(response);
              }
              expect(response.ok).toBe(true);
            });

            (
              await Promise.all(responses.map((response) => response.text()))
            ).forEach((text) => {
              expect(text.length).toBeGreaterThan(0);
            });
          },
          60 * 1000
        );
      }
    );
  });

  describe('using rspack for multiple platforms', () => {
    const startCommand = rspackCommands.find(
      (command) => command.name === 'start'
    );
    if (!startCommand) throw new Error('start command not found');

    const TMP_DIR = path.join(__dirname, 'out/start/rspack/multi-platform');

    beforeAll(async () => {
      await fs.promises.rm(TMP_DIR, {
        recursive: true,
        force: true,
      });

      port = await getPort();

      const config = {
        root: path.join(__dirname, '..'),
        platforms: { ios: {}, android: {} },
        reactNativePath: path.join(__dirname, '../node_modules/react-native'),
      };
      const args = {
        port,
        logFile: path.join(TMP_DIR, 'server.log'),
        webpackConfig: path.join(__dirname, '../rspack.config.mjs'),
      };

      // @ts-ignore
      const { stop } = await startCommand.func([], config, args);
      stopServer = stop;
    });

    afterAll(async () => {
      await stopServer();
    });

    it(
      'serves async chunks for every platform from the default start command',
      async () => {
        for (const platform of ['ios', 'android']) {
          const bundleResponse = await fetch(
            `http://localhost:${port}/index.bundle?platform=${platform}`
          );
          expect(bundleResponse.ok).toBe(true);
          await bundleResponse.arrayBuffer();

          const chunkResponse = await fetch(
            `http://localhost:${port}/${platform}/src_asyncChunks_Async_local_tsx.chunk.bundle`
          );
          expect(chunkResponse.ok).toBe(true);
          await expect(chunkResponse.text()).resolves.toContain(
            'this text comes from async chunk'
          );
        }
      },
      60 * 1000
    );
  });
});

async function expectRscRenderAndAction(input: {
  platform: string;
  port: number;
}): Promise<void> {
  const renderResponse = await postRsc(input, 'render', {
    id: 'rsc:["tester-app","root","TeamRoot.tsx","TeamRoot"]',
    props: { teamId: 'integration-team' },
  });
  expect(renderResponse.status).toBe(200);
  expect(renderResponse.headers.get('content-type')).toBe('text/x-component');
  const flightPayload = await renderResponse.text();
  expect(flightPayload).toContain('"teamId":"integration-team"');

  const clientChunkId = `tester-app:client:${input.platform}`;
  const clientBundlePath = `rsc/tester-app/development/${input.platform}/client.bundle`;
  expect(flightPayload).toContain(
    `["${clientChunkId}","./${clientBundlePath}"]`
  );
  const clientBundleResponse = await fetch(
    `http://localhost:${input.port}/${input.platform}/${clientBundlePath}`
  );
  expect(clientBundleResponse.ok).toBe(true);
  const clientBundle = await clientBundleResponse.text();
  expect(clientBundle).toContain(`.push([["${clientChunkId}"]`);
  expect(clientBundle).not.toContain('webpackBootstrap');
  expect(clientBundle).not.toContain('(repack-rsc-client)');
  expect(clientBundle).not.toContain('Invalid hook call');

  const actionResponse = await postRsc(
    input,
    'action',
    {
      data: { message: 'integration-action' },
      id: 'rsc:["tester-app","server-function","checkMe.ts","checkMe"]',
    },
    { 'x-tester-check-me': 'allowed' }
  );
  expect(actionResponse.status).toBe(200);
  expect(actionResponse.headers.get('content-type')).toBe('text/x-component');
  await expect(actionResponse.text()).resolves.toContain(
    '"message":"integration-action (allowed)"'
  );
}

function postRsc(
  input: { platform: string; port: number },
  kind: 'action' | 'render',
  body: object,
  headers?: HeadersInit
): Promise<Response> {
  return fetch(
    `http://localhost:${input.port}/__repack/rsc/tester-app/${input.platform}`,
    {
      body: JSON.stringify(body),
      headers: {
        accept: 'text/x-component',
        'content-type': 'text/plain;charset=UTF-8',
        'x-repack-rsc-kind': kind,
        'x-repack-rsc-platform': input.platform,
        'x-repack-rsc-protocol-version': '1',
        'x-repack-rsc-runtime-version': '7',
        'x-repack-rsc-unit': 'tester-app',
        ...headers,
      },
      method: 'POST',
    }
  );
}
