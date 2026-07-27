import type { Compilation } from '@rspack/core';
import { compareStrings } from '../artifacts/ordering.js';
import type { RscClientReferenceContract } from '../artifacts/types.js';
import { createRscClientReferenceContracts } from '../compiler/contracts/index.js';
import type { RscCompiledClientModuleTarget } from '../compiler/contracts/index.js';
import type { RscCompilationPlan } from '../compiler/plan/index.js';
import { toPhysicalFilename } from './sourceCatalog.js';

/** Project Rspack-assigned module and chunk facts onto planned identities. */
export function createRspackClientReferenceContracts(input: {
  readonly compilation: Compilation;
  readonly plan: RscCompilationPlan;
}): readonly RscClientReferenceContract[] {
  const targets: RscCompiledClientModuleTarget[] = [];
  const targetFilenames = new Set(
    input.plan.clientReferenceClaims.map((claim) => claim.targetFilename)
  );

  for (const module of input.compilation.modules) {
    const candidate = module as typeof module & { resource?: string };
    if (!candidate.resource || candidate.resource.includes('?')) {
      continue;
    }
    const filename = toPhysicalFilename(candidate.resource);
    if (!filename || !targetFilenames.has(filename)) {
      continue;
    }
    const moduleId = input.compilation.chunkGraph.getModuleId(module);
    if (moduleId === null) {
      continue;
    }
    const chunks = [];
    for (const chunk of input.compilation.chunkGraph.getModuleChunksIterable(
      module
    )) {
      const chunkId = chunk.id;
      if (chunkId === null || chunkId === undefined) {
        continue;
      }
      for (const file of [...chunk.files].sort()) {
        chunks.push({ file: `./${file}`, id: chunkId });
      }
    }
    targets.push({
      async: input.compilation.moduleGraph.isAsync(module),
      chunks: chunks.sort(
        (left, right) =>
          compareStrings(String(left.id), String(right.id)) ||
          compareStrings(left.file, right.file)
      ),
      filename,
      moduleId,
    });
  }

  return createRscClientReferenceContracts({
    claims: input.plan.clientReferenceClaims,
    mode: input.plan.kind === 'development' ? 'development' : 'production',
    targets,
    unit: input.plan.unit,
  });
}
