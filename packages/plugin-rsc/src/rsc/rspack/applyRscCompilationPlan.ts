import path from 'node:path';
import type { Compiler } from '@rspack/core';
import {
  RSC_INTERNAL_CLIENT_RUNTIME_ID,
  RSC_INTERNAL_DEPLOYMENT_VERIFIER_ID,
  RSC_INTERNAL_DEV_SERVER_LOCATION_ID,
  RSC_INTERNAL_FLIGHT_SERVER_ID,
  RSC_INTERNAL_SERVER_HANDLER_ID,
  getRscServerOutputLayout,
} from '../compiler/plan/index.js';
import type { RscCompilationPlan } from '../compiler/plan/index.js';
import { RSC_SERVER_LAYER } from './constants.js';
import { generateRscModuleSource } from './generatedModules.js';
import type { RscSourceCatalog } from './sourceCatalog.js';

const PLUGIN_NAME = 'RepackRscCompilationPlan';
const SOURCE_MODULE_PATTERN = /\.(?:[cm]?[jt]sx?|flow)$/i;

export interface RscRspackAdapterOverrides {
  readonly clientRuntime?: string;
  readonly deploymentVerifier?: string;
  readonly devServerLocation?: string;
  readonly flightServer?: string;
  readonly loader?: string;
  readonly serverHandler?: string;
}

export interface RscAppliedDevelopmentCompilation {
  readonly entrySource: string;
  readonly filename: string;
  readonly moduleReplacements: ReadonlyMap<string, string>;
}

interface ApplyRscCompilationPlanInput {
  readonly adapters: RscRspackAdapterOverrides;
  readonly compiler: Compiler;
  readonly plan: RscCompilationPlan;
  readonly sourceCatalog: RscSourceCatalog;
}

/** Translate and apply one compiler-independent RSC plan to Rspack. */
export function applyRscCompilationPlan(
  input: ApplyRscCompilationPlanInput
): RscAppliedDevelopmentCompilation | undefined {
  const { compiler, plan } = input;
  const generatedPaths = new Map<string, string>();
  const virtualModules: Record<string, string> = {};
  let deploymentStartupPath: string | undefined;
  let development:
    | Omit<RscAppliedDevelopmentCompilation, 'moduleReplacements'>
    | undefined;

  for (const generatedModule of plan.generatedModules) {
    const filename = createVirtualModulePath(
      compiler.context,
      plan,
      generatedModule
    );
    generatedPaths.set(generatedModule.id, filename);
    virtualModules[filename] = generateRscModuleSource(generatedModule);
    if (generatedModule.role === 'deployment-startup') {
      deploymentStartupPath = filename;
    }
  }

  const moduleReplacements = new Map<string, string>(generatedPaths);
  moduleReplacements.set(
    RSC_INTERNAL_CLIENT_RUNTIME_ID,
    input.adapters.clientRuntime ??
      path.join(__dirname, '../client/clientRuntime.js')
  );
  moduleReplacements.set(
    RSC_INTERNAL_DEV_SERVER_LOCATION_ID,
    input.adapters.devServerLocation ??
      path.join(__dirname, '../development/getDevServerLocation.js')
  );
  moduleReplacements.set(
    RSC_INTERNAL_DEPLOYMENT_VERIFIER_ID,
    input.adapters.deploymentVerifier ??
      path.join(__dirname, '../server/deployment.js')
  );
  moduleReplacements.set(
    RSC_INTERNAL_FLIGHT_SERVER_ID,
    input.adapters.flightServer ?? 'react-server-dom-webpack/server.edge'
  );
  moduleReplacements.set(
    RSC_INTERNAL_SERVER_HANDLER_ID,
    input.adapters.serverHandler ?? path.join(__dirname, '../server/handler.js')
  );
  for (const replacement of plan.moduleReplacements) {
    moduleReplacements.set(replacement.request, replacement.replacement);
  }

  compiler.options.experiments.layers = true;
  const serverOutputLayout =
    plan.kind === 'server' ? getRscServerOutputLayout(plan) : undefined;
  if (serverOutputLayout) {
    compiler.options.experiments.outputModule = true;
    compiler.options.optimization.runtimeChunk = false;
    compiler.options.optimization.splitChunks = false;
    Object.assign(compiler.options.output, {
      chunkFormat: 'module',
      chunkLoading: false,
      enabledChunkLoadingTypes: [],
      enabledLibraryTypes: ['module'],
      filename: serverOutputLayout.entry.path,
      library: { type: 'module' },
      module: true,
    });
    new compiler.webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }).apply(
      compiler
    );
  }

  new compiler.webpack.experiments.VirtualModulesPlugin(virtualModules).apply(
    compiler
  );
  if (deploymentStartupPath) {
    compiler.options.module.rules.unshift({
      include: deploymentStartupPath,
      parser: { importMeta: false, url: false },
    });
  }
  new compiler.webpack.NormalModuleReplacementPlugin(
    /^repack:rsc\//,
    (resource) => {
      const replacement = moduleReplacements.get(resource.request);
      if (replacement) {
        resource.request = replacement;
      }
    }
  ).apply(compiler);
  compiler.options.resolve.alias = {
    ...compiler.options.resolve.alias,
    ...Object.fromEntries(moduleReplacements),
  };
  compiler.options.module.rules.unshift({
    issuerLayer: RSC_SERVER_LAYER,
    resolve: {
      conditionNames: [
        'react-server',
        ...(compiler.options.resolve.conditionNames ?? []),
      ],
    },
  });
  compiler.options.module.rules.unshift({
    enforce: 'pre',
    include: [...input.sourceCatalog.roots],
    test: SOURCE_MODULE_PATTERN,
    use: [
      {
        loader: input.adapters.loader ?? path.join(__dirname, 'rscLoader.js'),
        options: {
          clientReferences: plan.clientReferenceClaims,
          roots: input.sourceCatalog.roots,
          unit: plan.unit,
        },
      },
    ],
  });

  for (const graph of plan.graphs) {
    if (
      graph.kind === 'server' &&
      graph.entryOutput.kind === 'development-server'
    ) {
      const request = graph.entries[0];
      const generatedPath = request && generatedPaths.get(request);
      const entrySource = generatedPath && virtualModules[generatedPath];
      if (!request || !generatedPath || !entrySource) {
        throw new Error(
          `RSC development graph "${graph.name}" has no generated entry source.`
        );
      }
      development = { entrySource, filename: graph.entryOutput.path };
      continue;
    }

    for (const request of new Set(graph.entries)) {
      new compiler.webpack.EntryPlugin(
        compiler.context,
        generatedPaths.get(request) ?? request,
        {
          dependOn:
            graph.kind === 'client'
              ? Object.keys(compiler.options.entry)
              : undefined,
          filename:
            graph.kind === 'server'
              ? serverOutputLayout?.entry.path
              : isStaticEntryFilename(compiler.options.output.filename)
                ? graph.entryOutput.path
                : undefined,
          layer: graph.kind === 'server' ? RSC_SERVER_LAYER : undefined,
          name: graph.name,
        }
      ).apply(compiler);
    }
  }

  const clientGraph = plan.graphs.find((graph) => graph.kind === 'client');
  if (clientGraph && plan.clientEntries.length > 0) {
    compiler.hooks.finishMake.tapPromise(PLUGIN_NAME, async (compilation) => {
      if (compilation.compiler.isChild()) {
        return;
      }
      await Promise.all(
        plan.clientEntries.map(
          (request) =>
            new Promise<void>((resolve, reject) => {
              const dependency =
                compiler.webpack.EntryPlugin.createDependency(request);
              compilation.addInclude(
                compiler.context,
                dependency,
                { name: clientGraph.name },
                (error) => (error ? reject(error) : resolve())
              );
            })
        )
      );
    });
  }

  return development ? { ...development, moduleReplacements } : undefined;
}

function createVirtualModulePath(
  context: string,
  plan: RscCompilationPlan,
  module: RscCompilationPlan['generatedModules'][number]
): string {
  const suffix = module.platform ? `.${module.platform}` : '';
  return path.join(
    context,
    'node_modules',
    '.cache',
    'repack',
    'rsc',
    plan.unit,
    plan.kind,
    ...(plan.kind === 'server' ? [] : [plan.platforms[0]!]),
    `${module.role}${suffix}.repack-rsc`
  );
}

function isStaticEntryFilename(outputFilename: unknown): boolean {
  return (
    typeof outputFilename === 'string' &&
    !/\[(?:chunkhash|contenthash|id|name)(?::\d+)?\]/.test(outputFilename)
  );
}
