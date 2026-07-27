import { canonicalJsonBytes } from '../artifacts/canonicalJson.js';
import { compareStrings } from '../artifacts/ordering.js';
import type {
  RscExecutableContractPlan,
  RscGeneratedClientReferenceResolverPlan,
  RscGeneratedClientRuntimePlan,
  RscGeneratedDeploymentStartupPlan,
  RscGeneratedDevelopmentTransportPlan,
  RscGeneratedModulePlan,
  RscGeneratedServerRuntimePlan,
} from '../compiler/plan/types.js';

const GENERATED_SOURCE_BY_ROLE = {
  'platform-manifest': 'export default Object.freeze({});\n',
} as const;

export function generateRscModuleSource(
  module: RscGeneratedModulePlan
): string {
  if (module.role === 'client-runtime') {
    return generateRscClientRuntimeSource(module.input);
  }
  if (module.role === 'development-transport') {
    return generateRscDevelopmentTransportSource(module.input);
  }
  if (module.role === 'deployment-startup') {
    return generateRscDeploymentStartupSource(module.input);
  }
  if (module.role === 'server-runtime') {
    return generateRscServerRuntimeSource(module.input);
  }
  if (module.role === 'client-reference-resolver') {
    return generateRscClientReferenceResolverSource(module.input);
  }
  return GENERATED_SOURCE_BY_ROLE[module.role];
}

function generateRscDeploymentStartupSource(
  input: RscGeneratedDeploymentStartupPlan['input']
): string {
  const platforms = [...input.platforms].sort(compareStrings);
  return [
    `import { verifyRscDeploymentAtStartup } from ${JSON.stringify(input.verifierModule)};`,
    `verifyRscDeploymentAtStartup({ directory: new URL(".", import.meta.url), platforms: ${JSON.stringify(platforms)}, runtimeVersion: ${JSON.stringify(input.runtimeVersion)}, unit: ${JSON.stringify(input.unit)} });`,
    '',
  ].join('\n');
}

function generateRscDevelopmentTransportSource(
  input: RscGeneratedDevelopmentTransportPlan['input']
): string {
  return [
    `import { getDevServerLocation } from ${JSON.stringify(input.devServerLocationModule)};`,
    `const endpoint = new URL(${JSON.stringify(input.pathname)}, getDevServerLocation().origin).href;`,
    'export default Object.freeze({',
    '  createTransport() {',
    '    return Object.freeze({',
    '      fetch(request) {',
    '        return globalThis.fetch(endpoint, request.init);',
    '      },',
    '    });',
    '  },',
    '});',
    '',
  ].join('\n');
}

function generateRscServerRuntimeSource(
  input: RscGeneratedServerRuntimePlan['input']
): string {
  const platformResolverModules = input.development
    ? []
    : [...input.platformResolverModules].sort(compareStrings);
  const roots = sortExecutableContracts(input.roots);
  const serverFunctions = sortExecutableContracts(input.serverFunctions);
  const lines = [
    ...(input.deploymentStartupModule
      ? [`import ${JSON.stringify(input.deploymentStartupModule)};`]
      : []),
    `import serverModule from ${JSON.stringify(input.setupModule)};`,
    `import { createRscErrorDigest, createRscHandler } from ${JSON.stringify(input.handlerModule)};`,
    `import { decodeReply, renderToReadableStream } from ${JSON.stringify(input.flightServerModule)};`,
    ...platformResolverModules.map(
      (module, index) =>
        `import platformManifest${index} from ${JSON.stringify(module)};`
    ),
    ...roots.map(
      (root, index) =>
        `import * as rootModule${index} from ${JSON.stringify(root.module)};`
    ),
    ...serverFunctions.map(
      (serverFunction, index) =>
        `import * as serverFunctionModule${index} from ${JSON.stringify(serverFunction.module)};`
    ),
    'const server = serverModule && typeof serverModule === "object" && "default" in serverModule ? serverModule.default : serverModule;',
    createExecutableMapSource('roots', roots, 'rootModule'),
  ];

  lines.push(
    createExecutableMapSource(
      'serverFunctions',
      serverFunctions,
      'serverFunctionModule'
    )
  );
  if (input.development) {
    lines.push(
      'export function createHandler(platformManifests) {',
      '  return createRscHandler({',
      '    development: true,',
      '    platformManifests,',
      '    roots,',
      `    runtimeVersion: ${JSON.stringify(input.runtimeVersion)},`,
      '    server,',
      '    serverFunctions,',
      `    unit: ${JSON.stringify(input.unit)},`,
      '  }, {',
      '    createDigest: createRscErrorDigest,',
      '    decodeReply,',
      '    render: renderToReadableStream,',
      '  });',
      '}',
      ''
    );
  } else {
    lines.push(
      `const platformManifests = Object.freeze([${platformResolverModules
        .map((_module, index) => `platformManifest${index}`)
        .join(', ')}]);`,
      'export const handler = createRscHandler({',
      '  development: false,',
      '  platformManifests,',
      '  roots,',
      `  runtimeVersion: ${JSON.stringify(input.runtimeVersion)},`,
      '  server,',
      '  serverFunctions,',
      `  unit: ${JSON.stringify(input.unit)},`,
      '}, {',
      '  createDigest: createRscErrorDigest,',
      '  decodeReply,',
      '  render: renderToReadableStream,',
      '});',
      'export default handler;',
      ''
    );
  }
  return lines.join('\n');
}

function generateRscClientReferenceResolverSource(
  input: RscGeneratedClientReferenceResolverPlan['input']
): string {
  return `export default Object.freeze(${new TextDecoder().decode(
    canonicalJsonBytes(input.platformManifest)
  )});\n`;
}

function sortExecutableContracts(
  contracts: readonly RscExecutableContractPlan[]
): RscExecutableContractPlan[] {
  return [...contracts].sort(
    (left, right) =>
      compareStrings(left.id, right.id) ||
      compareStrings(left.module, right.module) ||
      compareStrings(left.exportName, right.exportName)
  );
}

function createExecutableMapSource(
  name: string,
  contracts: readonly RscExecutableContractPlan[],
  namespace: string
): string {
  return `const ${name} = new Map([${contracts
    .map(
      (contract, index) =>
        `[${JSON.stringify(contract.id)}, ${namespace}${index}[${JSON.stringify(contract.exportName)}]]`
    )
    .join(', ')}]);`;
}

function generateRscClientRuntimeSource(
  input: RscGeneratedClientRuntimePlan['input']
): string {
  const context = {
    development: input.context.development,
    platform: input.context.platform,
    runtimeVersion: input.context.runtimeVersion,
    unit: input.context.unit,
  };
  const roots = input.roots
    .map((root) => ({
      id: root.id,
      identity: {
        exportName: root.identity.exportName,
        sourcePath: root.identity.sourcePath,
      },
    }))
    .sort((left, right) => compareStrings(left.id, right.id));
  const serverFunctions = input.serverFunctions
    .map((serverFunction) => ({
      id: serverFunction.id,
      identity: {
        exportName: serverFunction.identity.exportName,
        sourcePath: serverFunction.identity.sourcePath,
      },
    }))
    .sort((left, right) => compareStrings(left.id, right.id));
  return [
    `import runtimeConfig from ${JSON.stringify(input.runtimeModule)};`,
    "import { createFromReadableStream, encodeReply } from 'react-server-dom-webpack/client';",
    "import { createRscClientRuntime } from 'repack:rsc/internal/client-runtime';",
    'const unitRuntime = createRscClientRuntime({',
    '  config: runtimeConfig,',
    `  context: Object.freeze(${JSON.stringify(context)}),`,
    '  decode: createFromReadableStream,',
    '  encode: encodeReply,',
    `  roots: Object.freeze(${JSON.stringify(roots)}),`,
    `  serverFunctions: Object.freeze(${JSON.stringify(serverFunctions)}),`,
    '});',
    'if (__DEV__ && module.hot) {',
    '  module.hot.dispose(() => {',
    '    void unitRuntime.dispose();',
    '  });',
    '}',
    'export const createMiddleware = unitRuntime.createMiddleware;',
    'export const createRscRootProxy = unitRuntime.createRscRootProxy;',
    'export const createServerFnProxy = unitRuntime.createServerFnProxy;',
    '',
  ].join('\n');
}
