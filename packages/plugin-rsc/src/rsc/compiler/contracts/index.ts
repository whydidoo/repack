import { compareStrings } from '../../artifacts/ordering.js';
import {
  areRscLogicalIdentitiesEqual,
  createRscContractIdentityPayload,
  createRscLogicalIdentityKey,
  formatRscLogicalIdentity,
} from '../../identity.js';
import { analyzeRscModule } from '../parseRscModule.js';
import type {
  RscAnalyzedExportAll,
  RscAnalyzedReExport,
} from '../parseRscModule.js';
import { RscContractIndexError } from './errors.js';
import { hashRscContractIdentity } from './hashRscContractIdentity.js';
import type {
  CreateRscClientReferenceContractsInput,
  CreateRscContractIdInput,
  IndexRscContractsInput,
  RscClientReferenceContracts,
  RscCompiledClientModuleTarget,
  RscContractIndex,
  RscContractSourceModule,
  RscIndexedContract,
} from './types.js';

type NamedReExport = RscAnalyzedReExport;

type ExportAll = RscAnalyzedExportAll;

function compareContracts(
  left: RscIndexedContract,
  right: RscIndexedContract
): number {
  return (
    compareStrings(left.identity.sourcePath, right.identity.sourcePath) ||
    compareStrings(left.identity.exportName, right.identity.exportName) ||
    compareStrings(left.kind, right.kind)
  );
}

export function createRscContractId(input: CreateRscContractIdInput): string {
  const canonicalIdentity = createRscContractIdentityPayload(input);
  if (input.mode === 'development') {
    return `rsc:${canonicalIdentity}`;
  }
  return `rsc_${hashRscContractIdentity(canonicalIdentity)}`;
}

export function indexRscContracts(
  input: IndexRscContractsInput
): RscContractIndex {
  const clientEntries: string[] = [];
  const contracts: RscIndexedContract[] = [];
  const modulesByFilename = new Map(
    input.modules.map((module) => [module.filename, module])
  );
  const pendingAliases: Array<{
    readonly module: RscContractSourceModule;
    readonly reExport: NamedReExport;
    readonly targetFilename: string;
  }> = [];
  const pendingExportAll: Array<{
    readonly clientModule: boolean;
    readonly exportAll: ExportAll;
    readonly module: RscContractSourceModule;
    readonly targetFilename: string;
  }> = [];

  for (const module of input.modules) {
    const analysis = analyzeRscModule(module.source, module.filename);
    const discovery = analysis.discovery;
    for (const declaration of discovery.declarations) {
      if (declaration.kind === 'middleware') {
        continue;
      }
      const kind = declaration.kind === 'root' ? 'root' : 'server-function';
      contracts.push({
        claim: {
          filename: module.filename,
          location: declaration.location,
        },
        identity: {
          exportName: declaration.exportName,
          sourcePath: module.sourcePath,
        },
        kind,
        target: {
          exportName: declaration.exportName,
          filename: module.filename,
          sourcePath: module.sourcePath,
        },
      });
    }

    const clientModule = discovery.clientModule;
    for (const exportAll of analysis.exportAll) {
      const targetFilename = input.resolve({
        importer: module.filename,
        specifier: exportAll.specifier,
      });
      if (targetFilename && modulesByFilename.has(targetFilename)) {
        pendingExportAll.push({
          clientModule,
          exportAll,
          module,
          targetFilename,
        });
      }
    }
    if (!clientModule) {
      for (const reExport of analysis.namedReExports) {
        const targetFilename = input.resolve({
          importer: module.filename,
          specifier: reExport.specifier,
        });
        if (targetFilename && modulesByFilename.has(targetFilename)) {
          pendingAliases.push({ module, reExport, targetFilename });
        }
      }
      continue;
    }

    clientEntries.push(module.filename);
    for (const { exportName, location } of analysis.clientExports) {
      contracts.push({
        claim: {
          filename: module.filename,
          location,
        },
        identity: {
          exportName,
          sourcePath: module.sourcePath,
        },
        kind: 'client-reference',
        target: {
          exportName,
          filename: module.filename,
          sourcePath: module.sourcePath,
        },
      });
    }
  }

  const contractsByIdentity = new Map(
    contracts.map((contract) => [
      createRscLogicalIdentityKey(contract.identity),
      contract,
    ])
  );
  let unresolvedAliases = pendingAliases;
  while (unresolvedAliases.length > 0) {
    const nextUnresolved = [];
    let resolvedAny = false;

    for (const alias of unresolvedAliases) {
      const targetModule = modulesByFilename.get(alias.targetFilename);
      const target = targetModule
        ? contractsByIdentity.get(
            createRscLogicalIdentityKey({
              exportName: alias.reExport.importedName,
              sourcePath: targetModule.sourcePath,
            })
          )
        : undefined;
      if (!target) {
        nextUnresolved.push(alias);
        continue;
      }

      const contract: RscIndexedContract = {
        claim: {
          filename: alias.module.filename,
          location: alias.reExport.location,
        },
        identity: {
          exportName: alias.reExport.exportName,
          sourcePath: alias.module.sourcePath,
        },
        kind: target.kind,
        target: target.target,
      };
      contracts.push(contract);
      contractsByIdentity.set(
        createRscLogicalIdentityKey(contract.identity),
        contract
      );
      resolvedAny = true;
    }

    if (!resolvedAny) {
      break;
    }
    unresolvedAliases = nextUnresolved;
  }

  const sortedContracts = contracts.sort(compareContracts);
  for (let index = 1; index < sortedContracts.length; index += 1) {
    const previous = sortedContracts[index - 1];
    const current = sortedContracts[index];
    if (
      previous &&
      current &&
      areRscLogicalIdentitiesEqual(previous.identity, current.identity)
    ) {
      const identity = formatRscLogicalIdentity(current.identity);
      throw new RscContractIndexError({
        code: 'RSC_CONTRACT_IDENTITY_COLLISION',
        filename: current.claim.filename,
        location: current.claim.location,
        message:
          `RSC contract identity collision for "${identity}".\n` +
          'Every RSC contract must have one canonical source path and export name.',
      });
    }
  }

  for (const pending of pendingExportAll) {
    const targetModule = modulesByFilename.get(pending.targetFilename);
    if (
      pending.clientModule ||
      (targetModule &&
        contracts.some(
          (contract) => contract.identity.sourcePath === targetModule.sourcePath
        ))
    ) {
      throw new RscContractIndexError({
        code: 'RSC_CONTRACT_EXPORT_ALL_UNSUPPORTED',
        filename: pending.module.filename,
        location: pending.exportAll.location,
        message:
          'RSC contracts cannot be re-exported with export * from ' +
          `'${pending.exportAll.specifier}'.\n` +
          'Use static named re-exports instead.',
      });
    }
  }

  return {
    clientEntries: clientEntries.sort(),
    contracts: sortedContracts,
  };
}

export function createRscClientReferenceContracts(
  input: CreateRscClientReferenceContractsInput
): RscClientReferenceContracts {
  const targets = new Map<string, RscCompiledClientModuleTarget>();
  for (const target of input.targets) {
    if (targets.has(target.filename)) {
      throw new RscContractIndexError({
        code: 'RSC_CLIENT_REFERENCE_TARGET_COLLISION',
        filename: target.filename,
        location: { column: 0, line: 1 },
        message: `Multiple compiled targets were provided for "${target.filename}".`,
      });
    }
    targets.set(target.filename, target);
  }

  return input.claims.map((claim) => {
    const target = targets.get(claim.targetFilename);
    if (!target) {
      throw new RscContractIndexError({
        code: 'RSC_CLIENT_REFERENCE_TARGET_MISSING',
        filename: claim.targetFilename,
        location: { column: 0, line: 1 },
        message:
          'No compiled client target was provided for ' +
          `"${claim.targetFilename}".`,
      });
    }

    return {
      id: createRscContractId({
        identity: {
          exportName: claim.exportName,
          sourcePath: claim.sourcePath,
        },
        kind: 'client-reference',
        mode: input.mode,
        unit: input.unit,
      }),
      identity: {
        exportName: claim.exportName,
        sourcePath: claim.sourcePath,
      },
      target: {
        async: target.async,
        chunks: target.chunks,
        exportName: claim.targetExportName,
        moduleId: target.moduleId,
      },
    };
  });
}

export type {
  CreateRscClientReferenceContractsInput,
  CreateRscContractIdInput,
  IndexRscContractsInput,
  ResolveRscContractModule,
  ResolveRscContractModuleInput,
  RscContractIndex,
  RscContractSourceModule,
  RscCompiledClientModuleTarget,
  RscClientReferenceContracts,
  RscClientReferenceProjectionClaim,
  RscIndexedContract,
  RscIndexedContractClaim,
  RscIndexedContractKind,
  RscIndexedContractTarget,
} from './types.js';
export { RscContractIndexError } from './errors.js';
export type {
  RscContractIndexErrorCode,
  RscContractIndexErrorOptions,
} from './errors.js';
