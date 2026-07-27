import type { Compiler } from '@rspack/core';
import { createRscClientArtifact } from '../artifacts/index.js';
import { planRscCompilation } from '../compiler/plan/index.js';
import type {
  PlanRscDevelopmentTarget,
  PlanRscMobileTarget,
  PlanRscServerTarget,
  RscCompilationPlan,
} from '../compiler/plan/index.js';
import type { NormalizedRscConfig } from '../config/normalizeRscConfig.js';
import { setupRscDevelopmentLifecycle } from '../development/rspackDevelopmentLifecycle.js';
import { applyRscCompilationPlan } from './applyRscCompilationPlan.js';
import { setupRscContractAnalysisLifecycle } from './rscContractAnalysisLifecycle.js';
import { createRspackClientReferenceContracts } from './rspackClientReferenceContracts.js';
import { createRscSourceCatalog } from './sourceCatalog.js';

const PLUGIN_NAME = 'RepackRscRspackPlugin';

export interface RscRspackPluginOptions {
  readonly config: NormalizedRscConfig;
  /** Internal test seam. Production uses Re.Pack's private client runtime. */
  readonly clientRuntime?: string;
  /** Internal source-test seam. Production resolves the emitted JS module. */
  readonly devServerLocation?: string;
  /** Internal test seam. Production uses Re.Pack's private deployment verifier. */
  readonly deploymentVerifier?: string;
  /** Internal test seam. Production uses react-server-dom-webpack/server.edge. */
  readonly flightServer?: string;
  /** Internal test seam. Production uses the compiled Re.Pack loader. */
  readonly loader?: string;
  /** Internal test seam. Production uses Re.Pack's private RSC handler. */
  readonly serverHandler?: string;
  readonly target:
    | PlanRscDevelopmentTarget
    | PlanRscMobileTarget
    | PlanRscServerTarget;
}

export class RscRspackPlugin {
  constructor(private readonly options: RscRspackPluginOptions) {}

  apply(compiler: Compiler): void {
    const sourceCatalog = createRscSourceCatalog(
      this.options.config.server.roots
    );
    const developmentLifecycle =
      this.options.target.kind === 'development'
        ? setupRscDevelopmentLifecycle({
            compiler,
            platform: this.options.target.platform,
            unit: this.options.config.name,
          })
        : undefined;
    const contractIndex = setupRscContractAnalysisLifecycle({
      compiler,
      sourceCatalog,
      target: this.options.target,
      unit: this.options.config.name,
    });
    if (!contractIndex) {
      return;
    }
    const plan = planRscCompilation({
      config: this.options.config,
      contractIndex,
      target: this.options.target,
    });
    const developmentCompilation = applyRscCompilationPlan({
      adapters: this.options,
      compiler,
      plan,
      sourceCatalog,
    });

    if (developmentLifecycle) {
      if (!developmentCompilation) {
        throw new Error(
          `RSC development compilation for "${plan.unit}" was not generated.`
        );
      }
      developmentLifecycle.configureCompilation({
        development: developmentCompilation,
        plan,
      });
    }

    this.emitMobileClientArtifact(compiler, plan);
  }

  private emitMobileClientArtifact(
    compiler: Compiler,
    plan: RscCompilationPlan
  ): void {
    const output = plan.outputs.find(
      (candidate) => candidate.kind === 'client-artifact'
    );
    if (!output || compiler.options.mode !== 'production') {
      return;
    }

    const pluginName = `${PLUGIN_NAME}:${plan.unit}:${output.platform}:client-artifact`;
    const coordinate = `${plan.unit}/${plan.runtimeVersion}/${output.platform}`;
    let emittedIntegrity: string | undefined;

    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      if (compilation.compiler !== compiler) {
        return;
      }
      compilation.hooks.processAssets.tap(
        {
          name: pluginName,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          if (compilation.errors.length > 0) {
            return;
          }

          const clientReferences = createRspackClientReferenceContracts({
            compilation,
            plan,
          });
          const artifact = createRscClientArtifact({
            platform: output.platform,
            platformManifest: {
              clientReferences,
              platform: output.platform,
              runtimeVersion: plan.runtimeVersion,
              unit: plan.unit,
            },
            roots: output.roots,
            runtimeVersion: plan.runtimeVersion,
            serverFunctions: output.serverFunctions,
            unit: plan.unit,
          });
          if (
            emittedIntegrity !== undefined &&
            emittedIntegrity !== artifact.value.integrity
          ) {
            compilation.errors.push(
              Object.assign(
                new Error(
                  `RSC client artifact coordinate "${coordinate}" produced different content during one compiler lifecycle. Bump runtimeVersion before publishing the changed mobile contract.`
                ),
                { hideStack: true }
              )
            );
            return;
          }
          emittedIntegrity = artifact.value.integrity;
          compilation.emitAsset(
            output.path,
            new compiler.webpack.sources.RawSource(Buffer.from(artifact.bytes)),
            { immutable: true }
          );
        }
      );
    });
  }
}
