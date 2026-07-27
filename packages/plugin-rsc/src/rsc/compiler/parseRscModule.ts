import { parse } from '@babel/parser';
import type { ParserPlugin } from '@babel/parser';
import { RscDiscoveryError } from './discovery/errors.js';
import type {
  RscDeclaration,
  RscDeclarationKind,
  RscDiscoveryResult,
  RscSourceLocation,
} from './discovery/types.js';
import {
  callChainHasMethod,
  collectCallArgumentReferences,
  collectLexicallyFreeReferences,
  findCallChainBase,
  findCallChainMethod,
  getCalledMethodName,
  getStaticMiddlewareBindings,
  getStaticRscRootOptions,
  hasPropsSchema,
  isStaticallySerializable,
} from './moduleAnalysisSyntax.js';
import type { StaticRscRootOptionsResult } from './moduleAnalysisSyntax.js';

const SERVER_SUBPATH = '@callstack/repack-plugin-rsc/server';

const declarationKinds = new Map<string, RscDeclarationKind>([
  ['createMiddleware', 'middleware'],
  ['defineRscRoot', 'root'],
  ['createServerFn', 'server-function'],
]);

const declarationFactories = {
  middleware: 'createMiddleware',
  root: 'defineRscRoot',
  'server-function': 'createServerFn',
} as const;

const declarationLabels = {
  middleware: 'RSC middleware',
  root: 'RSC root',
  'server-function': 'Server Function',
} as const;

const functionNodeTypes = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);

export interface RscSourceRange {
  readonly end: number;
  readonly start: number;
}

export interface RscAnalyzedExport {
  readonly exportName: string;
  readonly location: RscSourceLocation;
}

export interface RscAnalyzedReExport extends RscAnalyzedExport {
  readonly importedName: string;
  readonly specifier: string;
}

export interface RscAnalyzedExportAll {
  readonly location: RscSourceLocation;
  readonly specifier: string;
}

export interface RscAnalyzedReExportStatement extends RscSourceRange {
  readonly source: string;
  readonly specifiers: readonly (RscAnalyzedExport & RscSourceRange)[];
}

interface RscAnalyzedDeclarationBase extends RscSourceRange {
  readonly location: RscSourceLocation;
  readonly name: string;
}

export interface RscAnalyzedMiddleware extends RscAnalyzedDeclarationBase {
  readonly base: RscSourceRange;
  readonly clientCall?: RscSourceRange & { readonly calleeEnd: number };
  readonly invalidSharedCapture?: string;
  readonly kind: 'middleware';
  readonly serverCall?: RscSourceRange & { readonly calleeEnd: number };
}

export interface RscAnalyzedRoot extends RscAnalyzedDeclarationBase {
  readonly kind: 'root';
  readonly objectFormWithoutProps: boolean;
  readonly options?: StaticRscRootOptionsResult;
  readonly propsSchema: boolean;
}

export interface RscAnalyzedServerFunction extends RscAnalyzedDeclarationBase {
  readonly hasHandler: boolean;
  readonly hasInputValidator: boolean;
  readonly kind: 'server-function';
  readonly middlewareBindings?: readonly string[];
}

export type RscAnalyzedDeclaration =
  | RscAnalyzedMiddleware
  | RscAnalyzedRoot
  | RscAnalyzedServerFunction;

/**
 * Parser-independent facts used by all compiler source consumers. The Babel
 * program is deliberately retained only by this module while these facts are
 * collected.
 */
export interface RscModuleAnalysis {
  readonly clientExports: readonly RscAnalyzedExport[];
  readonly declarationSyntax: readonly RscAnalyzedDeclaration[];
  readonly discovery: RscDiscoveryResult;
  readonly exportAll: readonly RscAnalyzedExportAll[];
  readonly namedReExports: readonly RscAnalyzedReExport[];
  readonly pruning: RscPruningAnalysis;
  readonly reExportStatements: readonly RscAnalyzedReExportStatement[];
}

export interface RscPruningAnalysis {
  readonly candidates: readonly (RscSourceRange & {
    readonly declaration?: RscSourceRange;
    readonly names: readonly string[];
    readonly references: ReadonlySet<string>;
  })[];
  readonly externalReferences: ReadonlySet<string>;
  readonly imports: readonly (RscSourceRange & {
    readonly bindings: readonly string[];
  })[];
  readonly referenceLocations: readonly {
    readonly name: string;
    readonly start: number;
  }[];
}

function getParserPlugins(filename: string): ParserPlugin[] {
  const typedSyntax: ParserPlugin = /\.(?:[cm]?ts|tsx)$/.test(filename)
    ? 'typescript'
    : ['flow', { all: true }];

  return ['decorators-legacy', typedSyntax, 'jsx'];
}

function parseProgram(source: string, filename: string) {
  return parse(source, {
    errorRecovery: false,
    plugins: getParserPlugins(filename),
    sourceFilename: filename,
    sourceType: 'module',
  }).program;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNode(value: unknown): value is Record<string, unknown> & {
  type: string;
} {
  return isRecord(value) && 'type' in value && typeof value.type === 'string';
}

function getSourceLocation(value: unknown): RscSourceLocation | undefined {
  if (!isRecord(value) || !isRecord(value.loc) || !isRecord(value.loc.start)) {
    return undefined;
  }
  const { column, line } = value.loc.start;
  return typeof column === 'number' && typeof line === 'number'
    ? { column, line }
    : undefined;
}

function getSourceRange(value: unknown): RscSourceRange | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { end, start } = value;
  return typeof end === 'number' && typeof start === 'number'
    ? { end, start }
    : undefined;
}

function findFactoryCalleeName(value: unknown): string | undefined {
  if (!isNode(value) || value.type !== 'CallExpression') {
    return undefined;
  }

  if (
    isNode(value.callee) &&
    value.callee.type === 'Identifier' &&
    typeof value.callee.name === 'string'
  ) {
    return value.callee.name;
  }

  if (
    isNode(value.callee) &&
    value.callee.type === 'MemberExpression' &&
    isNode(value.callee.object) &&
    value.callee.object.type === 'CallExpression'
  ) {
    return findFactoryCalleeName(value.callee.object);
  }

  return undefined;
}

function findDirective(value: unknown, directiveValue: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const directive = findDirective(item, directiveValue);
      if (directive) {
        return directive;
      }
    }
    return undefined;
  }

  if (!isNode(value)) {
    return undefined;
  }

  if (
    value.type === 'Directive' &&
    isNode(value.value) &&
    value.value.type === 'DirectiveLiteral' &&
    value.value.value === directiveValue
  ) {
    return value;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'loc') {
      const directive = findDirective(child, directiveValue);
      if (directive) {
        return directive;
      }
    }
  }

  return undefined;
}

function visitFactoryCalls(
  value: unknown,
  importedBindings: ReadonlyMap<string, RscDeclarationKind>,
  skippedExpressions: ReadonlySet<unknown>,
  shadowedBindings: ReadonlySet<string>,
  visit: (value: Record<string, unknown>, kind: RscDeclarationKind) => void
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitFactoryCalls(
        item,
        importedBindings,
        skippedExpressions,
        shadowedBindings,
        visit
      );
    }
    return;
  }

  if (!isNode(value) || skippedExpressions.has(value)) {
    return;
  }

  let bindingsInScope = shadowedBindings;
  if (functionNodeTypes.has(value.type) && Array.isArray(value.params)) {
    const functionBindings = new Set(shadowedBindings);
    for (const parameter of value.params) {
      if (
        isNode(parameter) &&
        parameter.type === 'Identifier' &&
        typeof parameter.name === 'string'
      ) {
        functionBindings.add(parameter.name);
      }
    }
    bindingsInScope = functionBindings;
  }
  if (value.type === 'BlockStatement' && Array.isArray(value.body)) {
    const blockBindings = new Set(bindingsInScope);
    for (const statement of value.body) {
      if (!isNode(statement)) {
        continue;
      }
      if (
        statement.type === 'VariableDeclaration' &&
        Array.isArray(statement.declarations)
      ) {
        for (const declaration of statement.declarations) {
          if (
            isNode(declaration) &&
            isNode(declaration.id) &&
            declaration.id.type === 'Identifier' &&
            typeof declaration.id.name === 'string'
          ) {
            blockBindings.add(declaration.id.name);
          }
        }
      } else if (
        (statement.type === 'FunctionDeclaration' ||
          statement.type === 'ClassDeclaration') &&
        isNode(statement.id) &&
        statement.id.type === 'Identifier' &&
        typeof statement.id.name === 'string'
      ) {
        blockBindings.add(statement.id.name);
      }
    }
    bindingsInScope = blockBindings;
  }

  if (value.type === 'CallExpression') {
    const bindingName = findFactoryCalleeName(value);
    const kind = bindingName ? importedBindings.get(bindingName) : undefined;
    if (kind && bindingName && !bindingsInScope.has(bindingName)) {
      visit(value, kind);
      return;
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'loc') {
      visitFactoryCalls(
        child,
        importedBindings,
        skippedExpressions,
        bindingsInScope,
        visit
      );
    }
  }
}

function findReferencedFactoryKind(
  value: unknown,
  importedBindings: ReadonlyMap<string, RscDeclarationKind>
): RscDeclarationKind | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const kind = findReferencedFactoryKind(item, importedBindings);
      if (kind) {
        return kind;
      }
    }
    return undefined;
  }
  if (!isNode(value)) {
    return undefined;
  }
  if (value.type === 'Identifier' && typeof value.name === 'string') {
    return importedBindings.get(value.name);
  }
  if (value.type === 'CallExpression') {
    const bindingName = findFactoryCalleeName(value);
    const kind = bindingName ? importedBindings.get(bindingName) : undefined;
    if (kind) {
      return kind;
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'loc') {
      const kind = findReferencedFactoryKind(child, importedBindings);
      if (kind) {
        return kind;
      }
    }
  }
  return undefined;
}

function collectBindingNames(value: unknown, names: Set<string>): void {
  if (!isNode(value)) {
    return;
  }
  if (value.type === 'Identifier' && typeof value.name === 'string') {
    names.add(value.name);
    return;
  }
  if (value.type === 'RestElement') {
    collectBindingNames(value.argument, names);
    return;
  }
  if (value.type === 'AssignmentPattern') {
    collectBindingNames(value.left, names);
    return;
  }
  if (value.type === 'ArrayPattern' && Array.isArray(value.elements)) {
    for (const element of value.elements) {
      collectBindingNames(element, names);
    }
    return;
  }
  if (value.type === 'ObjectPattern' && Array.isArray(value.properties)) {
    for (const property of value.properties) {
      if (!isNode(property)) {
        continue;
      }
      collectBindingNames(
        property.type === 'RestElement' ? property.argument : property.value,
        names
      );
    }
  }
}

function collectPatternExports(
  pattern: unknown,
  exports: Map<string, RscSourceLocation>
): void {
  if (!isNode(pattern)) {
    return;
  }
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    const location = getSourceLocation(pattern);
    if (location) {
      exports.set(pattern.name, location);
    }
    return;
  }
  if (pattern.type === 'RestElement') {
    collectPatternExports(pattern.argument, exports);
    return;
  }
  if (pattern.type === 'AssignmentPattern') {
    collectPatternExports(pattern.left, exports);
    return;
  }
  if (pattern.type === 'ArrayPattern' && Array.isArray(pattern.elements)) {
    for (const element of pattern.elements) {
      collectPatternExports(element, exports);
    }
    return;
  }
  if (pattern.type === 'ObjectPattern' && Array.isArray(pattern.properties)) {
    for (const property of pattern.properties) {
      if (isNode(property)) {
        collectPatternExports(
          property.type === 'RestElement' ? property.argument : property.value,
          exports
        );
      }
    }
  }
}

function getExportedName(value: {
  readonly name?: string;
  readonly type: string;
  readonly value?: string;
}): string | undefined {
  return value.type === 'Identifier' ? value.name : value.value;
}

function getCallRange(value: unknown) {
  const range = getSourceRange(value);
  if (!range || !isRecord(value) || !isRecord(value.callee)) {
    return undefined;
  }
  const calleeEnd = value.callee.end;
  return typeof calleeEnd === 'number' ? { ...range, calleeEnd } : undefined;
}

function discoverProgram(
  program: ReturnType<typeof parseProgram>,
  filename: string
): RscDiscoveryResult {
  const useServerDirective = findDirective(program, 'use server');
  const useServerLocation = getSourceLocation(useServerDirective);
  if (useServerLocation) {
    throw new RscDiscoveryError({
      code: 'RSC_USE_SERVER_UNSUPPORTED',
      filename,
      location: useServerLocation,
      message:
        "'use server' is not supported by Re.Pack RSC.\n" +
        'Declare server functions with createServerFn().',
    });
  }

  const importedBindings = new Map<string, RscDeclarationKind>();
  for (const statement of program.body) {
    if (
      statement.type !== 'ImportDeclaration' ||
      statement.source.value !== SERVER_SUBPATH
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') {
        continue;
      }
      const importedName =
        specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value;
      const kind = declarationKinds.get(importedName);
      if (kind) {
        importedBindings.set(specifier.local.name, kind);
      }
    }
  }

  const declarations: RscDeclaration[] = [];
  const acceptedExpressions = new Set<unknown>();
  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const bindingName = findFactoryCalleeName(statement.declaration);
      const kind = bindingName ? importedBindings.get(bindingName) : undefined;
      const location = getSourceLocation(statement.declaration);
      if (kind && location) {
        throw new RscDiscoveryError({
          code: 'RSC_DECLARATION_DEFAULT_EXPORT',
          filename,
          location,
          message:
            'RSC declarations cannot use a default export.\n' +
            (kind === 'middleware'
              ? 'Declare local middleware instead: const middleware = createMiddleware(...).'
              : `Declare a named top-level export instead: export const Root = ${declarationFactories[kind]}(...).`),
        });
      }
    }

    const variableDeclaration =
      statement.type === 'VariableDeclaration'
        ? statement
        : statement.type === 'ExportNamedDeclaration' &&
            statement.declaration?.type === 'VariableDeclaration'
          ? statement.declaration
          : undefined;
    const exported = statement.type === 'ExportNamedDeclaration';
    if (!variableDeclaration) {
      continue;
    }

    for (const declarator of variableDeclaration.declarations) {
      if (!declarator.init) {
        continue;
      }
      if (declarator.id.type !== 'Identifier') {
        const kind = findReferencedFactoryKind(
          declarator.init,
          importedBindings
        );
        const location = getSourceLocation(declarator.id);
        if (kind && location) {
          throw new RscDiscoveryError({
            code: 'RSC_DECLARATION_NOT_NAMED',
            filename,
            location,
            message:
              `${declarationLabels[kind]} declarations must use a single identifier.\n` +
              `Change this to a named top-level${kind === 'middleware' ? '' : ' export'} const declaration.`,
          });
        }
        continue;
      }

      const bindingName =
        declarator.init.type === 'CallExpression'
          ? findFactoryCalleeName(declarator.init)
          : undefined;
      const kind = bindingName ? importedBindings.get(bindingName) : undefined;
      const location = getSourceLocation(declarator.id);
      if (!kind) {
        const dynamicKind = findReferencedFactoryKind(
          declarator.init,
          importedBindings
        );
        if (dynamicKind && location) {
          throw new RscDiscoveryError({
            code: 'RSC_DECLARATION_DYNAMIC',
            filename,
            location,
            message:
              `${declarationLabels[dynamicKind]} "${declarator.id.name}" must be ` +
              `initialized by one direct ${declarationFactories[dynamicKind]}(...) call.\n` +
              'Remove conditional or computed declaration logic.',
          });
        }
        continue;
      }
      if (!location) {
        continue;
      }
      if (variableDeclaration.kind !== 'const') {
        throw new RscDiscoveryError({
          code: 'RSC_DECLARATION_NOT_CONST',
          filename,
          location,
          message:
            `${declarationLabels[kind]} "${declarator.id.name}" must be declared with const.\n` +
            `Change it to: ${kind === 'middleware' ? '' : 'export '}const ${declarator.id.name} = ${declarationFactories[kind]}(...).`,
        });
      }

      if (kind === 'middleware') {
        acceptedExpressions.add(declarator.init);
        declarations.push({
          kind,
          localName: declarator.id.name,
          location,
        });
      } else if (exported) {
        acceptedExpressions.add(declarator.init);
        declarations.push({
          exportName: declarator.id.name,
          kind,
          location,
        });
      } else {
        throw new RscDiscoveryError({
          code: 'RSC_DECLARATION_NOT_EXPORTED',
          filename,
          location,
          message:
            `${declarationLabels[kind]} "${declarator.id.name}" must be ` +
            'declared as a named top-level export const.\n' +
            `Move it to: export const ${declarator.id.name} = ${declarationFactories[kind]}(...).`,
        });
      }
    }
  }

  visitFactoryCalls(
    program,
    importedBindings,
    acceptedExpressions,
    new Set(),
    (factoryCall, kind) => {
      const location = getSourceLocation(factoryCall);
      if (location) {
        throw new RscDiscoveryError({
          code: 'RSC_DECLARATION_NOT_TOP_LEVEL',
          filename,
          location,
          message:
            `${declarationLabels[kind]} declarations cannot be nested.\n` +
            `Move this call to a named top-level${kind === 'middleware' ? '' : ' export'} const.`,
        });
      }
    }
  );

  return {
    clientModule: program.directives.some(
      (directive) => directive.value.value === 'use client'
    ),
    declarations,
  };
}

export function analyzeRscModule(
  source: string,
  filename: string
): RscModuleAnalysis {
  const program = parseProgram(source, filename);
  const discovery = discoverProgram(program, filename);
  const clientExports = new Map<string, RscSourceLocation>();
  const exportAll: RscAnalyzedExportAll[] = [];
  const namedReExports: RscAnalyzedReExport[] = [];
  const reExportStatements: RscAnalyzedReExportStatement[] = [];
  const importedBindings = new Set<string>();
  const topLevelBindings = new Set<string>();
  const topLevelConstInitializers = new Map<string, unknown>();
  const topLevelBindingNodes = new Map<
    string,
    { readonly declaredNames: ReadonlySet<string>; readonly node: unknown }
  >();

  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) {
        importedBindings.add(specifier.local.name);
      }
      continue;
    }
    const topLevelDeclaration =
      statement.type === 'ExportNamedDeclaration'
        ? statement.declaration
        : statement;
    if (
      (topLevelDeclaration?.type === 'FunctionDeclaration' ||
        topLevelDeclaration?.type === 'ClassDeclaration') &&
      topLevelDeclaration.id
    ) {
      topLevelBindings.add(topLevelDeclaration.id.name);
      topLevelBindingNodes.set(topLevelDeclaration.id.name, {
        declaredNames: new Set([topLevelDeclaration.id.name]),
        node: topLevelDeclaration,
      });
    }
    const variableDeclaration =
      statement.type === 'VariableDeclaration'
        ? statement
        : statement.type === 'ExportNamedDeclaration' &&
            statement.declaration?.type === 'VariableDeclaration'
          ? statement.declaration
          : undefined;
    for (const declaration of variableDeclaration?.declarations ?? []) {
      const declarationBindings = new Set<string>();
      collectBindingNames(declaration.id, declarationBindings);
      for (const name of declarationBindings) {
        topLevelBindings.add(name);
        topLevelBindingNodes.set(name, {
          declaredNames: declarationBindings,
          node: declaration,
        });
      }
      if (
        declaration.id.type === 'Identifier' &&
        variableDeclaration?.kind === 'const'
      ) {
        topLevelConstInitializers.set(declaration.id.name, declaration.init);
      }
    }
  }

  const topLevelDependencies = new Map<string, ReadonlySet<string>>();
  for (const [name, binding] of topLevelBindingNodes) {
    const references = collectLexicallyFreeReferences(binding.node);
    topLevelDependencies.set(
      name,
      new Set(
        [...references].filter(
          (reference) =>
            !binding.declaredNames.has(reference) &&
            (topLevelBindings.has(reference) || importedBindings.has(reference))
        )
      )
    );
  }

  const collectReachableTopLevelBindings = (
    references: ReadonlySet<string>
  ): ReadonlySet<string> => {
    const reachable = new Set<string>();
    const pending = [...references].filter(
      (name) => topLevelBindings.has(name) || importedBindings.has(name)
    );
    while (pending.length > 0) {
      const name = pending.shift();
      if (!name || reachable.has(name)) {
        continue;
      }
      reachable.add(name);
      for (const dependency of topLevelDependencies.get(name) ?? []) {
        if (!reachable.has(dependency)) {
          pending.push(dependency);
        }
      }
    }
    return reachable;
  };

  for (const statement of program.body) {
    if (statement.type === 'ExportAllDeclaration' && statement.loc) {
      exportAll.push({
        location: {
          column: statement.loc.start.column,
          line: statement.loc.start.line,
        },
        specifier: statement.source.value,
      });
      continue;
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      const location = getSourceLocation(statement);
      if (location) {
        clientExports.set('default', location);
      }
      continue;
    }
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      statement.exportKind === 'type'
    ) {
      continue;
    }

    const declaration = statement.declaration;
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        collectPatternExports(declarator.id, clientExports);
      }
    } else if (
      (declaration?.type === 'FunctionDeclaration' ||
        declaration?.type === 'ClassDeclaration') &&
      declaration.id
    ) {
      const location = getSourceLocation(declaration.id);
      if (location) {
        clientExports.set(declaration.id.name, location);
      }
    }

    const statementRange = getSourceRange(statement);
    const analyzedSpecifiers: Array<RscAnalyzedExport & RscSourceRange> = [];
    for (const specifier of statement.specifiers) {
      const exportName = getExportedName(specifier.exported);
      const location = getSourceLocation(specifier);
      if (!exportName || !location) {
        continue;
      }
      if (
        specifier.type === 'ExportSpecifier' &&
        specifier.exportKind !== 'type'
      ) {
        clientExports.set(exportName, location);
        if (statement.source) {
          const importedName = getExportedName(specifier.local);
          if (importedName) {
            namedReExports.push({
              exportName,
              importedName,
              location,
              specifier: statement.source.value,
            });
          }
        }
      } else if (specifier.type === 'ExportNamespaceSpecifier') {
        clientExports.set(exportName, location);
      }
      const range = getSourceRange(specifier);
      if (statement.source && range) {
        analyzedSpecifiers.push({ exportName, location, ...range });
      }
    }
    if (statement.source && statementRange) {
      reExportStatements.push({
        ...statementRange,
        source: statement.source.value,
        specifiers: analyzedSpecifiers,
      });
    }
  }

  const declarationsByName = new Map(
    discovery.declarations.map((declaration) => [
      declaration.kind === 'middleware'
        ? declaration.localName
        : declaration.exportName,
      declaration,
    ])
  );
  const declarationSyntax: RscAnalyzedDeclaration[] = [];
  for (const statement of program.body) {
    const variableDeclaration =
      statement.type === 'VariableDeclaration'
        ? statement
        : statement.type === 'ExportNamedDeclaration' &&
            statement.declaration?.type === 'VariableDeclaration'
          ? statement.declaration
          : undefined;
    for (const declarator of variableDeclaration?.declarations ?? []) {
      if (
        declarator.id.type !== 'Identifier' ||
        declarator.init?.type !== 'CallExpression'
      ) {
        continue;
      }
      const declaration = declarationsByName.get(declarator.id.name);
      const range = getSourceRange(declarator.init);
      if (!declaration || !range) {
        continue;
      }
      const common = {
        ...range,
        location: declaration.location,
        name: declarator.id.name,
      };
      if (declaration.kind === 'middleware') {
        const clientCall = findCallChainMethod(declarator.init, 'client');
        const serverCall = findCallChainMethod(declarator.init, 'server');
        const base = getSourceRange(findCallChainBase(declarator.init));
        if (!base) {
          continue;
        }
        let invalidSharedCapture: string | undefined;
        if (clientCall && serverCall) {
          const clientReferences = collectReachableTopLevelBindings(
            collectCallArgumentReferences(clientCall)
          );
          const serverReferences = collectReachableTopLevelBindings(
            collectCallArgumentReferences(serverCall)
          );
          invalidSharedCapture = [...clientReferences].find(
            (name) =>
              serverReferences.has(name) &&
              (importedBindings.has(name) ||
                (topLevelBindings.has(name) &&
                  (!topLevelConstInitializers.has(name) ||
                    !isStaticallySerializable(
                      topLevelConstInitializers.get(name),
                      (identifier) => topLevelConstInitializers.get(identifier)
                    ))))
          );
        }
        declarationSyntax.push({
          ...common,
          base,
          clientCall: clientCall ? getCallRange(clientCall) : undefined,
          invalidSharedCapture,
          kind: 'middleware',
          serverCall: serverCall ? getCallRange(serverCall) : undefined,
        });
      } else if (declaration.kind === 'root') {
        const propsSchema = hasPropsSchema(declarator.init);
        declarationSyntax.push({
          ...common,
          kind: 'root',
          objectFormWithoutProps:
            !propsSchema &&
            declarator.init.arguments[0]?.type === 'ObjectExpression',
          options: propsSchema
            ? getStaticRscRootOptions(declarator.init)
            : undefined,
          propsSchema,
        });
      } else {
        declarationSyntax.push({
          ...common,
          hasHandler: getCalledMethodName(declarator.init) === 'handler',
          hasInputValidator: callChainHasMethod(
            declarator.init,
            'inputValidator'
          ),
          kind: 'server-function',
          middlewareBindings: getStaticMiddlewareBindings(declarator.init),
        });
      }
    }
  }

  return {
    clientExports: [...clientExports].map(([exportName, location]) => ({
      exportName,
      location,
    })),
    declarationSyntax,
    discovery,
    exportAll,
    namedReExports,
    pruning: analyzeProgramPruning(program),
    reExportStatements,
  };
}

function isNonReferenceIdentifier(
  parent: Record<string, unknown> | undefined,
  key: string | undefined
): boolean {
  if (!parent || !key) {
    return false;
  }
  return (
    ((parent.type === 'MemberExpression' ||
      parent.type === 'OptionalMemberExpression') &&
      key === 'property' &&
      parent.computed === false) ||
    ((parent.type === 'ObjectProperty' ||
      parent.type === 'ObjectMethod' ||
      parent.type === 'ClassMethod') &&
      key === 'key' &&
      parent.computed === false) ||
    ((parent.type === 'LabeledStatement' ||
      parent.type === 'BreakStatement' ||
      parent.type === 'ContinueStatement') &&
      key === 'label')
  );
}

function collectReferencedIdentifiers(
  value: unknown,
  references: Set<string>,
  ignoredNodes: ReadonlySet<object>,
  referenceLocations?: Array<{ readonly name: string; readonly start: number }>,
  parent?: Record<string, unknown>,
  key?: string
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencedIdentifiers(
        item,
        references,
        ignoredNodes,
        referenceLocations,
        parent,
        key
      );
    }
    return;
  }
  if (
    !isNode(value) ||
    value.type === 'ImportDeclaration' ||
    ignoredNodes.has(value)
  ) {
    return;
  }
  if (
    value.type === 'Identifier' &&
    typeof value.name === 'string' &&
    !isNonReferenceIdentifier(parent, key)
  ) {
    references.add(value.name);
    if (referenceLocations && typeof value.start === 'number') {
      referenceLocations.push({ name: value.name, start: value.start });
    }
  }
  for (const [childKey, child] of Object.entries(value)) {
    if (
      childKey !== 'end' &&
      childKey !== 'extra' &&
      childKey !== 'loc' &&
      childKey !== 'start' &&
      childKey !== 'type'
    ) {
      collectReferencedIdentifiers(
        child,
        references,
        ignoredNodes,
        referenceLocations,
        value,
        childKey
      );
    }
  }
}

function analyzeProgramPruning(
  program: ReturnType<typeof parseProgram>
): RscPruningAnalysis {
  const ignoredNodes = new Set<object>();
  const candidateNodes: Array<
    RscSourceRange & {
      readonly declaration?: RscSourceRange;
      readonly names: string[];
      readonly node: object;
    }
  > = [];
  const imports: Array<
    RscSourceRange & { readonly bindings: readonly string[] }
  > = [];

  for (const statement of program.body) {
    const range = getSourceRange(statement);
    if (!range) {
      continue;
    }
    if (
      (statement.type === 'FunctionDeclaration' ||
        statement.type === 'ClassDeclaration') &&
      statement.id
    ) {
      ignoredNodes.add(statement.id);
      candidateNodes.push({
        ...range,
        names: [statement.id.name],
        node: statement,
      });
      continue;
    }
    if (
      statement.type === 'VariableDeclaration' &&
      statement.declarations.every(
        (declaration) => declaration.id.type === 'Identifier'
      )
    ) {
      for (const declaration of statement.declarations) {
        const declarationRange = getSourceRange(declaration);
        if (!declarationRange || declaration.id.type !== 'Identifier') {
          continue;
        }
        ignoredNodes.add(declaration.id);
        candidateNodes.push({
          ...declarationRange,
          declaration: range,
          names: [declaration.id.name],
          node: declaration,
        });
      }
      continue;
    }
    if (
      statement.type === 'ImportDeclaration' &&
      statement.specifiers.length > 0
    ) {
      imports.push({
        ...range,
        bindings: statement.specifiers.map((specifier) => specifier.local.name),
      });
    }
  }

  const referenceLocations: Array<{
    readonly name: string;
    readonly start: number;
  }> = [];
  collectReferencedIdentifiers(
    program,
    new Set(),
    ignoredNodes,
    referenceLocations
  );

  const candidateNodeSet = new Set<object>(
    candidateNodes.map((candidate) => candidate.node)
  );
  const externalReferences = new Set<string>();
  collectReferencedIdentifiers(program, externalReferences, candidateNodeSet);

  const candidates = candidateNodes.map(({ node, ...candidate }) => {
    const candidateReferences = new Set(collectLexicallyFreeReferences(node));
    for (const name of candidate.names) {
      candidateReferences.delete(name);
    }
    return { ...candidate, references: candidateReferences };
  });

  return {
    candidates,
    externalReferences,
    imports,
    referenceLocations,
  };
}
