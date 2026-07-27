import type { RscClientArtifactSet } from '../../artifacts/clientArtifactSet.js';
import type {
  RscAddressableContract,
  RscPlatformManifest,
} from '../../artifacts/types.js';
import type { NormalizedRscConfig } from '../../config/normalizeRscConfig.js';
import type { RscTransportContext } from '../../runtime/index.js';
import type { RscContractIndex } from '../contracts/types.js';

export type RscPlatform = 'android' | 'ios';

export interface PlanRscDevelopmentTarget {
  readonly kind: 'development';
  readonly platform: RscPlatform;
}

export interface PlanRscMobileTarget {
  readonly kind: 'mobile';
  readonly platform: RscPlatform;
}

export interface PlanRscServerTarget {
  readonly artifactSet: RscClientArtifactSet;
  readonly kind: 'server';
}

export interface PlanRscCompilationInput {
  readonly config: NormalizedRscConfig;
  readonly contractIndex: RscContractIndex;
  readonly target:
    | PlanRscDevelopmentTarget
    | PlanRscMobileTarget
    | PlanRscServerTarget;
}

interface RscGeneratedModulePlanBase {
  readonly graph: 'client' | 'server';
  readonly id: string;
  readonly platform?: RscPlatform;
}

export interface RscGeneratedClientRuntimePlan
  extends RscGeneratedModulePlanBase {
  readonly input: {
    readonly context: RscTransportContext;
    readonly roots: readonly RscAddressableContract[];
    readonly runtimeModule: string;
    readonly serverFunctions: readonly RscAddressableContract[];
  };
  readonly role: 'client-runtime';
}

export interface RscGeneratedDevelopmentTransportPlan
  extends RscGeneratedModulePlanBase {
  readonly input: {
    readonly devServerLocationModule: string;
    readonly pathname: string;
  };
  readonly role: 'development-transport';
}

export interface RscGeneratedDeploymentStartupPlan
  extends RscGeneratedModulePlanBase {
  readonly input: {
    readonly platforms: readonly string[];
    readonly runtimeVersion: string;
    readonly unit: string;
    readonly verifierModule: string;
  };
  readonly role: 'deployment-startup';
}

export interface RscGeneratedClientReferenceResolverPlan
  extends RscGeneratedModulePlanBase {
  readonly input: {
    readonly platformManifest: RscPlatformManifest;
  };
  readonly role: 'client-reference-resolver';
}

export interface RscGeneratedPlatformManifestPlan
  extends RscGeneratedModulePlanBase {
  readonly role: 'platform-manifest';
}

export interface RscExecutableContractPlan {
  readonly exportName: string;
  readonly id: string;
  readonly module: string;
}

export interface RscGeneratedServerRuntimePlan
  extends RscGeneratedModulePlanBase {
  readonly input: {
    readonly deploymentStartupModule?: string;
    readonly development: boolean;
    readonly flightServerModule: string;
    readonly handlerModule: string;
    readonly platformResolverModules: readonly string[];
    readonly roots: readonly RscExecutableContractPlan[];
    readonly runtimeVersion: string;
    readonly serverFunctions: readonly RscExecutableContractPlan[];
    readonly setupModule: string;
    readonly unit: string;
  };
  readonly role: 'server-runtime';
}

export type RscGeneratedModulePlan =
  | RscGeneratedClientReferenceResolverPlan
  | RscGeneratedClientRuntimePlan
  | RscGeneratedDeploymentStartupPlan
  | RscGeneratedDevelopmentTransportPlan
  | RscGeneratedPlatformManifestPlan
  | RscGeneratedServerRuntimePlan;

export interface RscClientReferenceClaimPlan {
  readonly exportName: string;
  readonly filename: string;
  readonly id: string;
  readonly sourcePath: string;
  readonly targetExportName: string;
  readonly targetFilename: string;
}

export interface RscClientGraphPlan {
  readonly entries: readonly string[];
  readonly entryOutput: {
    readonly path: string;
    readonly when: 'static-entry-filename';
  };
  readonly kind: 'client';
  readonly name: string;
  readonly platform: RscPlatform;
}

export interface RscServerGraphPlan {
  readonly entries: readonly string[];
  readonly entryOutput:
    | {
        readonly kind: 'development-server';
        readonly path: string;
      }
    | {
        readonly kind: 'deployment-entry';
      };
  readonly kind: 'server';
  readonly name: string;
  readonly platforms: readonly RscPlatform[];
}

export interface RscModuleReplacementPlan {
  readonly replacement: string;
  readonly request: string;
}

export interface RscCompilationPlan {
  readonly clientEntries: readonly string[];
  readonly clientReferenceClaims: readonly RscClientReferenceClaimPlan[];
  readonly generatedModules: readonly RscGeneratedModulePlan[];
  readonly graphs: readonly (RscClientGraphPlan | RscServerGraphPlan)[];
  readonly kind: PlanRscCompilationInput['target']['kind'];
  readonly moduleReplacements: readonly RscModuleReplacementPlan[];
  readonly outputs: readonly RscCompilationOutputPlan[];
  readonly platforms: readonly RscPlatform[];
  readonly runtimeVersion: string;
  readonly unit: string;
}

export interface RscClientArtifactOutputPlan {
  readonly kind: 'client-artifact';
  readonly path: string;
  readonly platform: RscPlatform;
  readonly roots: readonly RscAddressableContract[];
  readonly serverFunctions: readonly RscAddressableContract[];
}

export interface RscDeploymentManifestOutputPlan {
  readonly kind: 'deployment-manifest';
  readonly path: string;
}

export interface RscPackageManifestOutputPlan {
  readonly kind: 'package-manifest';
  readonly path: string;
  readonly type: 'module';
}

export interface RscPlatformManifestOutputPlan {
  readonly kind: 'platform-manifest';
  readonly manifest: RscPlatformManifest;
  readonly path: string;
  readonly platform: RscPlatform;
}

export interface RscServerEntryOutputPlan {
  readonly entry: string;
  readonly kind: 'server-entry';
  readonly path: string;
}

export type RscCompilationOutputPlan =
  | RscClientArtifactOutputPlan
  | RscDeploymentManifestOutputPlan
  | RscPackageManifestOutputPlan
  | RscPlatformManifestOutputPlan
  | RscServerEntryOutputPlan;

export interface RscServerOutputLayout {
  readonly deploymentManifest: RscDeploymentManifestOutputPlan;
  readonly entry: RscServerEntryOutputPlan;
  readonly packageManifest: RscPackageManifestOutputPlan;
  readonly platformManifests: readonly RscPlatformManifestOutputPlan[];
}
