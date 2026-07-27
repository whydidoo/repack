import { createRequire } from 'node:module';
import path from 'node:path';
import { compileFunction } from 'node:vm';
import type { Compilation, Compiler } from '@rspack/core';
import type { RscPlatformManifest } from '../artifacts/types.js';
import { createRscDevelopmentPath } from '../compiler/plan/index.js';
import type { RscCompilationPlan } from '../compiler/plan/index.js';
import type { RscAppliedDevelopmentCompilation } from '../rspack/applyRscCompilationPlan.js';
import { RSC_SERVER_LAYER } from '../rspack/constants.js';
import { createRspackClientReferenceContracts } from '../rspack/rspackClientReferenceContracts.js';
import type { RscHandler } from '../server/handler.js';
import { toNodeMiddleware } from '../server/nodeAdapter.js';
import { registerRscDevServerRoute } from './devServerRoutes.js';

const PLUGIN_NAME = 'RepackRscDevelopmentLifecycle';

export interface SetupRscDevelopmentLifecycleInput {
  readonly compiler: Compiler;
  readonly platform: 'android' | 'ios';
  readonly unit: string;
}

export interface ConfigureRscDevelopmentCompilationInput {
  readonly development: RscAppliedDevelopmentCompilation;
  readonly plan: RscCompilationPlan;
}

export interface RscDevelopmentLifecycle {
  configureCompilation(input: ConfigureRscDevelopmentCompilationInput): void;
}

/** Own one development server graph from route registration through cleanup. */
export function setupRscDevelopmentLifecycle(
  input: SetupRscDevelopmentLifecycleInput
): RscDevelopmentLifecycle {
  const pluginName = `${PLUGIN_NAME}:${input.unit}:${input.platform}`;
  let candidateBundle: RscDevelopmentServerBundle | undefined;
  let currentHandler: RscHandler | undefined;
  let disposed = false;
  const handle: RscHandler = (request) => {
    if (currentHandler) {
      return currentHandler(request);
    }
    return Promise.resolve(createNotReadyResponse(input.unit, input.platform));
  };
  const disposeRoute = registerRscDevServerRoute(input.compiler, {
    path: createRscDevelopmentPath(input.unit, input.platform),
    handler: toNodeMiddleware(handle),
  });
  const cleanup = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    candidateBundle = undefined;
    currentHandler = undefined;
    disposeRoute();
  };
  input.compiler.hooks.watchClose.tap(pluginName, cleanup);
  input.compiler.hooks.shutdown.tap(pluginName, cleanup);

  return {
    configureCompilation(compilationInput) {
      const { development, plan } = compilationInput;
      if (plan.kind !== 'development') {
        throw new Error(
          `RSC development lifecycle received a ${plan.kind} compilation plan.`
        );
      }
      if (
        plan.unit !== input.unit ||
        plan.platforms.length !== 1 ||
        plan.platforms[0] !== input.platform
      ) {
        throw new Error(
          `RSC development lifecycle for "${input.unit}" requires its registered ${input.platform} compilation plan.`
        );
      }
      input.compiler.hooks.make.tapPromise(pluginName, async (compilation) => {
        if (disposed || compilation.compiler !== input.compiler) {
          return;
        }
        if (compilation.errors.length > 0) {
          return;
        }
        candidateBundle = undefined;
        const bundle = await compileRscDevelopmentServerBundle({
          compilation,
          compiler: input.compiler,
          entrySource: development.entrySource,
          filename: development.filename,
          moduleReplacements: development.moduleReplacements,
          pluginName,
        });
        if (bundle) {
          candidateBundle = bundle;
        }
      });

      input.compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
        if (disposed || compilation.compiler !== input.compiler) {
          return;
        }
        compilation.hooks.processAssets.tap(
          {
            name: pluginName,
            stage:
              input.compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
          },
          () => {
            if (disposed || compilation.errors.length > 0) {
              return;
            }
            const bundle = candidateBundle;
            if (!bundle) {
              compilation.errors.push(
                new Error(
                  `RSC development server bundle "${development.filename}" was not produced.`
                )
              );
              return;
            }

            try {
              const clientReferences = createRspackClientReferenceContracts({
                compilation,
                plan,
              });
              const platformManifest: RscPlatformManifest = Object.freeze({
                clientReferences,
                platform: input.platform,
                protocolVersion: 1,
                runtimeVersion: plan.runtimeVersion,
                schemaVersion: 1,
                unit: plan.unit,
              });
              currentHandler = evaluateRscDevelopmentServerBundle({
                bundle,
                context: input.compiler.context,
                platformManifest,
              });
            } catch (error) {
              compilation.errors.push(
                error instanceof Error
                  ? error
                  : new Error(
                      `Failed to initialize RSC development server: ${error}`
                    )
              );
            }
          }
        );
      });
    },
  };
}

function createNotReadyResponse(unit: string, platform: string): Response {
  return Response.json(
    {
      code: 'RSC_DEVELOPMENT_NOT_READY',
      detail: `The RSC development server for "${unit}" (${platform}) has not completed its first successful build.`,
      status: 503,
      title: 'RSC development server is not ready',
      type: 'about:blank',
    },
    {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/problem+json',
      },
      status: 503,
    }
  );
}

interface RscDevelopmentServerBundle {
  readonly filename: string;
  readonly source: string;
}

interface CompileRscDevelopmentServerBundleInput {
  readonly compilation: Compilation;
  readonly compiler: Compiler;
  readonly entrySource: string;
  readonly filename: string;
  readonly moduleReplacements: ReadonlyMap<string, string>;
  readonly pluginName: string;
}

function compileRscDevelopmentServerBundle(
  input: CompileRscDevelopmentServerBundleInput
): Promise<RscDevelopmentServerBundle | undefined> {
  const child = input.compilation.createChildCompiler(
    `${input.pluginName}:child`,
    {
      ...input.compiler.options.output,
      chunkFilename: '[name].server.cjs',
      chunkFormat: 'commonjs',
      chunkLoading: 'require',
      enabledChunkLoadingTypes: ['require'],
      enabledLibraryTypes: ['commonjs2'],
      filename: input.filename,
      globalObject: 'globalThis',
      library: { type: 'commonjs2' },
    },
    [
      new input.compiler.webpack.node.NodeTemplatePlugin(),
      new input.compiler.webpack.node.NodeTargetPlugin(),
      new input.compiler.webpack.LoaderTargetPlugin('node'),
      new input.compiler.webpack.library.EnableLibraryPlugin('commonjs2'),
      new input.compiler.webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1,
      }),
    ]
  );
  removeInheritedMobileRuntimeTaps(child);
  child.options.module.rules = child.options.module.rules.filter(
    (rule) => !containsReactRefreshLoader(rule)
  );
  child.options.devtool = false;
  new input.compiler.webpack.NormalModuleReplacementPlugin(
    /^repack:rsc\//,
    (resource) => {
      const replacement = input.moduleReplacements.get(resource.request);
      if (replacement) {
        resource.request = replacement;
      }
    }
  ).apply(child);
  new input.compiler.webpack.EntryPlugin(
    child.context,
    `data:text/javascript;charset=utf-8,${encodeURIComponent(input.entrySource)}`,
    {
      layer: RSC_SERVER_LAYER,
      library: { type: 'commonjs2' },
      name: 'server',
    }
  ).apply(child);

  return new Promise((resolve, reject) => {
    child.runAsChild((error, _entries, compilation) => {
      if (error) {
        reject(error);
        return;
      }
      if (!compilation) {
        reject(
          new Error('RSC development child compiler returned no compilation.')
        );
        return;
      }
      for (const asset of compilation.getAssets()) {
        input.compilation.deleteAsset(asset.name);
      }
      if (compilation.errors.length > 0) {
        input.compilation.errors.push(...compilation.errors);
        resolve(undefined);
        return;
      }
      const asset = compilation.getAsset(input.filename);
      if (!asset) {
        reject(
          new Error(
            `RSC development child compiler did not emit "${input.filename}".`
          )
        );
        return;
      }
      resolve({
        filename: input.filename,
        source: asset.source.source().toString(),
      });
    });
  });
}

function removeInheritedMobileRuntimeTaps(compiler: Compiler): void {
  const remove = (
    hook: { taps: Array<{ readonly name: string }> },
    names: ReadonlySet<string>
  ) => {
    for (let index = hook.taps.length - 1; index >= 0; index -= 1) {
      if (names.has(hook.taps[index]!.name)) {
        hook.taps.splice(index, 1);
      }
    }
  };

  // Rspack child compilers inherit parent taps. These Re.Pack taps target the
  // React Native bundle and must not inject its runtime into the Node graph.
  remove(
    compiler.hooks.compilation,
    new Set(['RepackNativeEntryPlugin', 'RepackTargetPlugin'])
  );
  remove(compiler.hooks.thisCompilation, new Set(['RepackTargetPlugin']));
}

function containsReactRefreshLoader(value: unknown): boolean {
  if (typeof value === 'string') {
    return /react-refresh-loader|reactRefreshLoader/.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsReactRefreshLoader);
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rule = value as Record<string, unknown>;
  return ['loader', 'oneOf', 'rules', 'use'].some((key) =>
    containsReactRefreshLoader(rule[key])
  );
}

function evaluateRscDevelopmentServerBundle(input: {
  readonly bundle: RscDevelopmentServerBundle;
  readonly context: string;
  readonly platformManifest: RscPlatformManifest;
}): RscHandler {
  const filename = path.join(input.context, input.bundle.filename);
  const module = { exports: {} as unknown };
  const execute = compileFunction(
    input.bundle.source,
    ['exports', 'require', 'module', '__filename', '__dirname'],
    { filename }
  );
  execute(
    module.exports,
    createRequire(path.join(input.context, 'package.json')),
    module,
    filename,
    path.dirname(filename)
  );
  const createHandler = (module.exports as { createHandler?: unknown })
    .createHandler;
  if (typeof createHandler !== 'function') {
    throw new Error(
      `RSC development server bundle "${input.bundle.filename}" does not export createHandler().`
    );
  }
  const handler = createHandler(Object.freeze([input.platformManifest]));
  if (typeof handler !== 'function') {
    throw new Error(
      `RSC development server bundle "${input.bundle.filename}" returned an invalid handler.`
    );
  }
  return handler as RscHandler;
}
