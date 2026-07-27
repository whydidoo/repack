import path from 'node:path';
import type { Compiler } from '@rspack/core';
import { compareStrings } from '../artifacts/ordering.js';
import {
  type RscContractIndex,
  type RscContractSourceModule,
  indexRscContracts,
} from '../compiler/contracts/index.js';
import type {
  PlanRscDevelopmentTarget,
  PlanRscMobileTarget,
  PlanRscServerTarget,
} from '../compiler/plan/index.js';
import {
  createRscContractSnapshotKey,
  formatRscContractLabel,
} from '../identity.js';
import { isRscSourceLocatedError } from './diagnostics.js';
import { scanRscContractSourceModules } from './scan.js';
import type { RscSourceCatalog } from './sourceCatalog.js';

const PLUGIN_NAME = 'RepackRscContractAnalysisLifecycle';

interface SetupRscContractAnalysisLifecycleInput {
  readonly compiler: Compiler;
  readonly sourceCatalog: RscSourceCatalog;
  readonly target:
    | PlanRscDevelopmentTarget
    | PlanRscMobileTarget
    | PlanRscServerTarget;
  readonly unit: string;
}

/** Own initial contract indexing and conservative rebuild compatibility. */
export function setupRscContractAnalysisLifecycle(
  input: SetupRscContractAnalysisLifecycleInput
): RscContractIndex | undefined {
  const resolver = input.compiler.resolverFactory.get('normal');
  const indexContracts = (
    modules: readonly RscContractSourceModule[]
  ): RscContractIndex =>
    indexRscContracts({
      modules,
      resolve: ({ importer, specifier }) => {
        try {
          const result = resolver.resolveSync(
            {},
            path.dirname(importer),
            specifier
          );
          return typeof result === 'string'
            ? input.sourceCatalog.claim(result)?.filename
            : undefined;
        } catch {
          return undefined;
        }
      },
    });
  let modules: readonly RscContractSourceModule[] = [];
  let baseline: RscContractIndex;
  try {
    modules = scanRscContractSourceModules(input.sourceCatalog);
    baseline = indexContracts(modules);
  } catch (error) {
    if (!isRscSourceLocatedError(error)) {
      throw error;
    }
    input.compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.errors.push(createRscCompilationError(error, modules));
    });
    return undefined;
  }

  const target = input.target;
  if (target.kind === 'server') {
    return baseline;
  }

  const pluginName = `${PLUGIN_NAME}:${input.unit}:${input.target.kind}`;
  const baselineSnapshot = createRscContractSnapshot(baseline);
  input.compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
    if (compilation.compiler !== input.compiler) {
      return;
    }
    for (const root of input.sourceCatalog.roots) {
      compilation.contextDependencies.add(root);
    }
  });
  input.compiler.hooks.make.tap(
    { name: pluginName, stage: -1_000 },
    (compilation) => {
      if (compilation.compiler !== input.compiler) {
        return;
      }
      let currentModules: readonly RscContractSourceModule[] = [];
      let current: RscContractIndex;
      try {
        currentModules = scanRscContractSourceModules(input.sourceCatalog);
        current = indexContracts(currentModules);
      } catch (error) {
        compilation.errors.push(
          createRscCompilationError(error, currentModules)
        );
        return;
      }
      const difference = diffRscContracts(
        baselineSnapshot,
        createRscContractSnapshot(current)
      );
      if (difference.added.length === 0 && difference.removed.length === 0) {
        return;
      }
      compilation.errors.push(
        Object.assign(
          new Error(
            createRscContractChangeMessage({
              difference,
              platform: target.platform,
              target: target.kind,
              unit: input.unit,
            })
          ),
          { hideStack: true }
        )
      );
    }
  );

  return baseline;
}

function createRscContractChangeMessage(input: {
  readonly difference: ReturnType<typeof diffRscContracts>;
  readonly platform: 'android' | 'ios';
  readonly target: 'development' | 'mobile';
  readonly unit: string;
}): string {
  const development = input.target === 'development';
  return [
    development
      ? `RSC development contract for unit "${input.unit}" (${input.platform}) changed while the dev server is running.`
      : `RSC production contract for unit "${input.unit}" (${input.platform}) changed during one compiler lifecycle.`,
    input.difference.removed.length > 0
      ? `Removed or changed: ${input.difference.removed.join(', ')}.`
      : undefined,
    input.difference.added.length > 0
      ? `Added or changed: ${input.difference.added.join(', ')}.`
      : undefined,
    development
      ? 'Restart the dev server to accept the new contract. Preserve old identities with static named re-exports when compatibility is required.'
      : 'Restart the compiler to accept the new contract. Bump runtimeVersion before publishing a changed mobile contract, or preserve old identities with static named re-exports.',
  ]
    .filter(Boolean)
    .join(' ');
}

function createRscCompilationError(
  error: unknown,
  modules: readonly RscContractSourceModule[]
): Error {
  if (!isRscSourceLocatedError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const source = modules.find(
    (module) => module.filename === error.filename
  )?.source;
  return Object.assign(new Error(error.message), {
    details: source,
    file: error.filename,
    hideStack: true,
    loc: {
      end: error.location,
      start: error.location,
    },
    name: error.name,
  });
}

function createRscContractSnapshot(
  index: RscContractIndex
): ReadonlyMap<string, string> {
  return new Map(
    index.contracts.map((contract) => [
      createRscContractSnapshotKey({
        identity: contract.identity,
        kind: contract.kind,
        target: contract.target,
      }),
      formatRscContractLabel(contract.kind, contract.identity),
    ])
  );
}

function diffRscContracts(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>
): { readonly added: readonly string[]; readonly removed: readonly string[] } {
  return {
    added: [...next]
      .filter(([key]) => !previous.has(key))
      .map(([, label]) => label)
      .sort(compareStrings),
    removed: [...previous]
      .filter(([key]) => !next.has(key))
      .map(([, label]) => label)
      .sort(compareStrings),
  };
}
