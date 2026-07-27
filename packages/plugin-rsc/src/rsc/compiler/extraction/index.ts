import { name as isIdentifierName } from 'estree-util-is-identifier-name';
import { analyzeRscModule } from '../parseRscModule.js';
import type { RscModuleAnalysis } from '../parseRscModule.js';
import { RscExtractionError } from './errors.js';
import {
  applySourceEdits,
  chooseGeneratedBinding,
  pruneUnreachableModuleCode,
} from './source.js';
import type { SourceEdit } from './source.js';
import type {
  ExtractRscDeclarationsInput,
  ExtractRscDeclarationsResult,
  ExtractedRscMiddleware,
  ExtractedRscRoot,
  ExtractedRscServerFunction,
} from './types.js';

const CLIENT_ROOT_PROXY_BINDING = '__repack_createRscRootProxy';
const CLIENT_SERVER_FN_PROXY_BINDING = '__repack_createServerFnProxy';
const CLIENT_MIDDLEWARE_BINDING = '__repack_createMiddleware';
const FLIGHT_SERVER_MODULE = 'repack:rsc/internal/flight-server';

function formatExportName(exportName: string): string {
  return isIdentifierName(exportName) ? exportName : JSON.stringify(exportName);
}

function generateClientReference(
  reference: NonNullable<
    ExtractRscDeclarationsInput['clientReferences']
  >[number],
  index: number
): string {
  const binding = `__repack_client_reference_${index}`;
  const message =
    `Attempted to call ${reference.exportName}() from the server, but it is ` +
    'a Client Reference. It can only be rendered or passed to a Client Component.';
  return [
    `const ${binding} = registerClientReference(function () {`,
    `  throw new Error(${JSON.stringify(message)});`,
    `}, ${JSON.stringify(reference.id)}, ${JSON.stringify(reference.targetExportName)});`,
    `export { ${binding} as ${formatExportName(reference.exportName)} };`,
  ].join('\n');
}

function preserveOriginalLineCount(source: string, replacement = ''): string {
  const sourceLineBreaks = source.match(/\n/g)?.length ?? 0;
  const replacementLineBreaks = replacement.match(/\n/g)?.length ?? 0;
  return `${replacement}${'\n'.repeat(
    Math.max(0, sourceLineBreaks - replacementLineBreaks)
  )}`;
}

function transformClientReferences(
  input: ExtractRscDeclarationsInput,
  analysis: RscModuleAnalysis
): string {
  const references = input.clientReferences ?? [];
  const generated = references
    .map((reference, index) => generateClientReference(reference, index))
    .join('\n');
  const flightImport = `import { registerClientReference } from '${FLIGHT_SERVER_MODULE}';`;

  if (analysis.discovery.clientModule) {
    if (references.length === 0) {
      return `${preserveOriginalLineCount(input.source)}\n`;
    }
    return `${preserveOriginalLineCount(input.source)}\n${flightImport}\n${generated}\n`;
  }

  const claimedExports = new Set(
    references.map((reference) => reference.exportName)
  );
  const edits: SourceEdit[] = [];
  for (const statement of analysis.reExportStatements) {
    const retainedSpecifiers = statement.specifiers.filter(
      (specifier) => !claimedExports.has(specifier.exportName)
    );
    if (retainedSpecifiers.length === statement.specifiers.length) {
      continue;
    }
    const replacement =
      retainedSpecifiers.length === 0
        ? ''
        : `export { ${retainedSpecifiers
            .map((specifier) =>
              input.source.slice(specifier.start, specifier.end)
            )
            .join(', ')} } from ${JSON.stringify(statement.source)};`;
    const original = input.source.slice(statement.start, statement.end);
    edits.push({
      end: statement.end,
      replacement: preserveOriginalLineCount(original, replacement),
      start: statement.start,
    });
  }

  const retainedSource =
    edits.length === 0 ? input.source : applySourceEdits(input.source, edits);
  return `${retainedSource}\n${flightImport}\n${generated}\n`;
}

export function extractRscDeclarations(
  input: ExtractRscDeclarationsInput
): ExtractRscDeclarationsResult {
  const analysis = analyzeRscModule(input.source, input.filename);
  const discovery = analysis.discovery;
  if (
    input.graph === 'server' &&
    (discovery.clientModule ||
      (input.clientReferences && input.clientReferences.length > 0))
  ) {
    return {
      code: transformClientReferences(input, analysis),
      middleware: [],
      roots: [],
      serverFunctions: [],
    };
  }
  if (analysis.declarationSyntax.length === 0) {
    return {
      code: input.source,
      middleware: [],
      roots: [],
      serverFunctions: [],
    };
  }

  const middleware: ExtractedRscMiddleware[] = [];
  const roots: ExtractedRscRoot[] = [];
  const serverFunctions: ExtractedRscServerFunction[] = [];
  const edits: SourceEdit[] = [];
  const clientRootProxyBinding = chooseGeneratedBinding(
    input.source,
    CLIENT_ROOT_PROXY_BINDING
  );
  const clientServerFnProxyBinding = chooseGeneratedBinding(
    input.source,
    CLIENT_SERVER_FN_PROXY_BINDING
  );
  const clientMiddlewareBinding = chooseGeneratedBinding(
    input.source,
    CLIENT_MIDDLEWARE_BINDING
  );

  for (const declaration of analysis.declarationSyntax) {
    if (declaration.kind === 'middleware') {
      if (declaration.invalidSharedCapture) {
        throw new RscExtractionError({
          code: 'RSC_MIDDLEWARE_CROSS_GRAPH_CAPTURE',
          filename: input.filename,
          location: declaration.location,
          message:
            `RSC middleware "${declaration.name}" captures ` +
            `"${declaration.invalidSharedCapture}" in both graph halves.\n` +
            'Only statically serializable top-level const values may be shared between .client() and .server().',
        });
      }
      middleware.push({
        client: Boolean(declaration.clientCall),
        localName: declaration.name,
        server: Boolean(declaration.serverCall),
      });

      const selectedCall =
        input.graph === 'client'
          ? declaration.clientCall
          : declaration.serverCall;
      let replacement =
        input.graph === 'client'
          ? `${clientMiddlewareBinding}()`
          : input.source.slice(declaration.base.start, declaration.base.end);
      if (selectedCall) {
        replacement +=
          `.${input.graph}` +
          input.source.slice(selectedCall.calleeEnd, selectedCall.end);
      }
      edits.push({
        end: declaration.end,
        replacement,
        start: declaration.start,
      });
      continue;
    }

    const identity = {
      exportName: declaration.name,
      sourcePath: input.sourcePath,
    };
    let replacementBinding: string;
    let replacementArguments = JSON.stringify(identity);
    if (declaration.kind === 'root') {
      if (declaration.objectFormWithoutProps) {
        throw new RscExtractionError({
          code: 'RSC_ROOT_SHORT_FORM_REQUIRED',
          filename: input.filename,
          location: declaration.location,
          message:
            `RSC root "${declaration.name}" has no props schema.\n` +
            `Use the short form: export const ${declaration.name} = ` +
            'defineRscRoot(async ({ context }) => ...).',
        });
      }
      if (declaration.propsSchema) {
        const rootOptions = declaration.options;
        if (!rootOptions?.valid) {
          const pending = rootOptions?.option === 'pending';
          throw new RscExtractionError({
            code: pending
              ? 'RSC_ROOT_PENDING_INVALID'
              : 'RSC_ROOT_RELOAD_ON_REQUIRED',
            filename: input.filename,
            location: declaration.location,
            message: pending
              ? `RSC root "${declaration.name}" has an invalid pending policy.\n` +
                "Use pending: 'retain' or pending: 'fallback'."
              : `RSC root "${declaration.name}" with props requires a non-empty static reloadOn list.\n` +
                "Declare primitive identity fields: reloadOn: ['teamId'].",
          });
        }
        roots.push({
          identity,
          pending: rootOptions.options.pending,
          props: { kind: 'standard-schema' },
          reloadOn: rootOptions.options.reloadOn,
        });
        replacementArguments += `, ${JSON.stringify(rootOptions.options)}`;
      } else {
        roots.push({ identity, props: { kind: 'none' } });
      }
      replacementBinding = clientRootProxyBinding;
    } else {
      if (!declaration.hasHandler) {
        throw new RscExtractionError({
          code: 'RSC_SERVER_FN_HANDLER_REQUIRED',
          filename: input.filename,
          location: declaration.location,
          message:
            `Server Function "${declaration.name}" has no handler.\n` +
            'Finish the declaration with .handler(async ({ data, context, signal }) => ...).',
        });
      }
      if (!declaration.middlewareBindings) {
        throw new RscExtractionError({
          code: 'RSC_MIDDLEWARE_STATIC_LIST_REQUIRED',
          filename: input.filename,
          location: declaration.location,
          message:
            `Server Function "${declaration.name}" has a dynamic middleware list.\n` +
            'Pass a static array of middleware bindings: .middleware([auth, audit]).',
        });
      }
      serverFunctions.push({
        identity,
        input: {
          kind: declaration.hasInputValidator ? 'standard-schema' : 'none',
        },
        middleware: declaration.middlewareBindings,
      });
      replacementBinding = clientServerFnProxyBinding;
      const clientMiddlewareBindings = declaration.middlewareBindings.filter(
        (binding) =>
          middleware.some(
            (entry) => entry.localName === binding && entry.client
          )
      );
      if (clientMiddlewareBindings.length > 0) {
        replacementArguments += `, [${clientMiddlewareBindings.join(', ')}]`;
      }
    }

    if (input.graph === 'client') {
      edits.push({
        end: declaration.end,
        replacement: `${replacementBinding}(${replacementArguments})`,
        start: declaration.start,
      });
    }
  }

  const transformedCode =
    edits.length === 0
      ? input.source
      : pruneUnreachableModuleCode(
          applySourceEdits(input.source, edits),
          input.filename,
          {
            originalAnalysis: analysis.pruning,
            preservedBindings: new Set(
              middleware.map((entry) => entry.localName)
            ),
            replacedRanges: edits,
          }
        );

  if (input.graph === 'server') {
    return { code: transformedCode, middleware, roots, serverFunctions };
  }

  const proxyImports = [];
  if (middleware.length > 0) {
    proxyImports.push(`createMiddleware as ${clientMiddlewareBinding}`);
  }
  if (roots.length > 0) {
    proxyImports.push(`createRscRootProxy as ${clientRootProxyBinding}`);
  }
  if (serverFunctions.length > 0) {
    proxyImports.push(`createServerFnProxy as ${clientServerFnProxyBinding}`);
  }
  const proxyImport =
    proxyImports.length === 0
      ? ''
      : `import { ${proxyImports.join(', ')} } ` +
        `from 'repack:rsc/${input.unit}/client-runtime';\n`;

  return {
    code: proxyImport ? `${transformedCode}\n${proxyImport}` : transformedCode,
    middleware,
    roots,
    serverFunctions,
  };
}

export type {
  ExtractedRscMiddleware,
  ExtractedRscServerFunction,
  ExtractRscDeclarationsInput,
  ExtractRscDeclarationsResult,
  ExtractedRscRoot,
} from './types.js';
export { RscExtractionError } from './errors.js';
export type {
  RscExtractionErrorCode,
  RscExtractionErrorOptions,
} from './errors.js';
