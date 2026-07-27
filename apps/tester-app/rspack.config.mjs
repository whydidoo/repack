import path from 'node:path';
import * as Repack from '@callstack/repack';
import { NativeWindPlugin } from '@callstack/repack-plugin-nativewind';
import { ReanimatedPlugin } from '@callstack/repack-plugin-reanimated';
import { RscPlugin } from '@callstack/repack-plugin-rsc';
import { RsdoctorRspackPlugin } from '@rsdoctor/rspack-plugin';
import { rspack } from '@rspack/core';

const dirname = Repack.getDirname(import.meta.url);

export default Repack.defineRspackConfig((env) => {
  const {
    mode = 'development',
    context = dirname,
    platform = process.env.PLATFORM,
  } = env;
  if (!platform) {
    throw new Error('Missing platform');
  }

  return {
    mode,
    context,
    entry: './index.js',
    resolve: {
      ...Repack.getResolveOptions({ enablePackageExports: true }),
    },
    output: {
      uniqueName: 'tester-app',
    },
    module: {
      rules: [
        {
          test: /\.[cm]?[jt]sx?$/,
          use: {
            loader: '@callstack/repack/babel-swc-loader',
            parallel: true,
            options: {},
          },
          type: 'javascript/auto',
        },
        {
          test: Repack.getAssetExtensionsRegExp(
            Repack.ASSET_EXTENSIONS.filter((ext) => ext !== 'svg')
          ),
          exclude: [
            path.join(context, 'src/assetsTest/localAssets'),
            path.join(context, 'src/assetsTest/inlineAssets'),
            path.join(context, 'src/assetsTest/remoteAssets'),
          ],
          use: '@callstack/repack/assets-loader',
        },
        {
          test: /\.svg$/,
          use: [
            {
              loader: '@svgr/webpack',
              options: {
                native: true,
                dimensions: false,
              },
            },
          ],
        },
        {
          test: Repack.getAssetExtensionsRegExp(
            Repack.ASSET_EXTENSIONS.filter((ext) => ext !== 'svg')
          ),
          include: [path.join(context, 'src/assetsTest/localAssets')],
          use: '@callstack/repack/assets-loader',
        },
        {
          test: Repack.getAssetExtensionsRegExp(
            Repack.ASSET_EXTENSIONS.filter((ext) => ext !== 'svg')
          ),
          include: [path.join(context, 'src/assetsTest/inlineAssets')],
          use: {
            loader: '@callstack/repack/assets-loader',
            options: { inline: true },
          },
        },
        {
          test: Repack.getAssetExtensionsRegExp(
            Repack.ASSET_EXTENSIONS.filter((ext) => ext !== 'svg')
          ),
          include: [path.join(context, 'src/assetsTest/remoteAssets')],
          use: {
            loader: '@callstack/repack/assets-loader',
            options: {
              remote: {
                enabled: true,
                publicPath: 'http://localhost:9999/remote-assets',
              },
            },
          },
        },
      ],
    },
    plugins: [
      new rspack.DefinePlugin({
        __REPACK_RSC_ENABLED__: JSON.stringify(true),
        'process.env.REPACK_RSC_RELEASE': JSON.stringify(
          process.env.REPACK_RSC_RELEASE ?? 'development'
        ),
      }),
      /**
       * Configure other required and additional plugins to make the bundle
       * work in React Native and provide good development experience with
       * sensible defaults.
       *
       * `Repack.RepackPlugin` provides some degree of customization, but if you
       * need more control, you can replace `Repack.RepackPlugin` with plugins
       * from `Repack.plugins`.
       */
      new Repack.RepackPlugin({
        platform,
        output: {
          auxiliaryAssetsPath: path.join('build/output', platform, 'remote'),
        },
        extraChunks: [
          {
            include: /^tester-app:client:/,
            type: 'local',
          },
          {
            include: /.+local.+/,
            type: 'local',
          },
          {
            exclude: /.+local.+/,
            type: 'remote',
            outputPath: path.join('build/output', platform, 'remote'),
          },
        ],
      }),
      new RscPlugin({
        name: 'tester-app',
        runtimeVersion: process.env.REPACK_RSC_RUNTIME_VERSION ?? '7',
        runtime: './src/rsc/rsc.runtime.ts',
        server: {
          roots: ['./src/rsc'],
          setup: './src/rsc/rsc.server.ts',
        },
      }),
      new ReanimatedPlugin({
        babelPluginOptions: { relativeSourceLocation: true },
        unstable_disableTransform: true,
      }),
      new NativeWindPlugin({ cssInteropOptions: { inlineRem: 16 } }),
      process.env.RSDOCTOR && new RsdoctorRspackPlugin(),
    ].filter(Boolean),
  };
});
