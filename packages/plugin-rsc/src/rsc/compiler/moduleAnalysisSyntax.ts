/** Babel-shaped implementation details owned by module source analysis. */
export function hasPropsSchema(initializer: {
  readonly arguments: readonly unknown[];
}): boolean {
  const definition = initializer.arguments[0];
  if (
    typeof definition !== 'object' ||
    definition === null ||
    !('type' in definition) ||
    definition.type !== 'ObjectExpression' ||
    !('properties' in definition) ||
    !Array.isArray(definition.properties)
  ) {
    return false;
  }

  return definition.properties.some(
    (property) =>
      typeof property === 'object' &&
      property !== null &&
      'type' in property &&
      (property.type === 'ObjectProperty' ||
        property.type === 'ObjectMethod') &&
      'key' in property &&
      typeof property.key === 'object' &&
      property.key !== null &&
      'type' in property.key &&
      ((property.key.type === 'Identifier' &&
        'name' in property.key &&
        property.key.name === 'props') ||
        (property.key.type === 'StringLiteral' &&
          'value' in property.key &&
          property.key.value === 'props'))
  );
}

type RscRootPendingPolicy = 'fallback' | 'retain';

export type StaticRscRootOptionsResult =
  | {
      readonly options: {
        readonly pending: RscRootPendingPolicy;
        readonly reloadOn: readonly string[];
      };
      readonly valid: true;
    }
  | {
      readonly option: 'pending' | 'reloadOn';
      readonly valid: false;
    };

export function getStaticRscRootOptions(initializer: {
  readonly arguments: readonly unknown[];
}): StaticRscRootOptionsResult {
  const definition = initializer.arguments[0];
  const reloadOn = getObjectPropertyValue(definition, 'reloadOn');
  if (
    !reloadOn.found ||
    !isNodeOfType(reloadOn.value, 'ArrayExpression') ||
    !('elements' in reloadOn.value) ||
    !Array.isArray(reloadOn.value.elements) ||
    reloadOn.value.elements.length === 0
  ) {
    return { option: 'reloadOn', valid: false };
  }

  const fields: string[] = [];
  for (const element of reloadOn.value.elements) {
    if (
      !isNodeOfType(element, 'StringLiteral') ||
      !('value' in element) ||
      typeof element.value !== 'string' ||
      fields.includes(element.value)
    ) {
      return { option: 'reloadOn', valid: false };
    }
    fields.push(element.value);
  }

  const pending = getObjectPropertyValue(definition, 'pending');
  if (!pending.found) {
    return {
      options: { pending: 'retain', reloadOn: fields },
      valid: true,
    };
  }
  if (
    !isNodeOfType(pending.value, 'StringLiteral') ||
    !('value' in pending.value) ||
    (pending.value.value !== 'fallback' && pending.value.value !== 'retain')
  ) {
    return { option: 'pending', valid: false };
  }

  return {
    options: { pending: pending.value.value, reloadOn: fields },
    valid: true,
  };
}

function getObjectPropertyValue(
  object: unknown,
  name: string
): { readonly found: boolean; readonly value?: unknown } {
  if (
    !isNodeOfType(object, 'ObjectExpression') ||
    !('properties' in object) ||
    !Array.isArray(object.properties)
  ) {
    return { found: false };
  }
  for (const property of object.properties) {
    if (
      typeof property !== 'object' ||
      property === null ||
      !('type' in property) ||
      property.type !== 'ObjectProperty' ||
      !('computed' in property) ||
      property.computed !== false ||
      !('key' in property) ||
      !isPropertyNamed(property.key, name)
    ) {
      continue;
    }
    return {
      found: true,
      value: 'value' in property ? property.value : undefined,
    };
  }
  return { found: false };
}

function isPropertyNamed(value: unknown, name: string): boolean {
  return (
    (isNodeOfType(value, 'Identifier') &&
      'name' in value &&
      value.name === name) ||
    (isNodeOfType(value, 'StringLiteral') &&
      'value' in value &&
      value.value === name)
  );
}

function isNodeOfType(
  value: unknown,
  type: string
): value is Record<string, unknown> & { readonly type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === type
  );
}

export function getCalledMethodName(expression: {
  readonly callee: unknown;
}): string | undefined {
  const callee = expression.callee;
  if (
    typeof callee !== 'object' ||
    callee === null ||
    !('type' in callee) ||
    callee.type !== 'MemberExpression' ||
    !('computed' in callee) ||
    callee.computed ||
    !('property' in callee) ||
    typeof callee.property !== 'object' ||
    callee.property === null ||
    !('type' in callee.property) ||
    callee.property.type !== 'Identifier' ||
    !('name' in callee.property)
  ) {
    return undefined;
  }

  return typeof callee.property.name === 'string'
    ? callee.property.name
    : undefined;
}

export function callChainHasMethod(
  expression: { readonly callee: unknown },
  methodName: string
): boolean {
  if (getCalledMethodName(expression) === methodName) {
    return true;
  }

  const callee = expression.callee;
  return (
    typeof callee === 'object' &&
    callee !== null &&
    'object' in callee &&
    typeof callee.object === 'object' &&
    callee.object !== null &&
    'type' in callee.object &&
    callee.object.type === 'CallExpression' &&
    'callee' in callee.object &&
    callChainHasMethod(callee.object, methodName)
  );
}

interface CallExpressionLike {
  readonly arguments: readonly unknown[];
  readonly callee: unknown;
  readonly end?: number | null;
  readonly start?: number | null;
}

function asCallExpression(value: unknown): CallExpressionLike | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'CallExpression' &&
    'callee' in value &&
    'arguments' in value &&
    Array.isArray(value.arguments)
    ? (value as CallExpressionLike)
    : undefined;
}

function getChainedCall(
  expression: CallExpressionLike
): CallExpressionLike | undefined {
  const callee = expression.callee;
  return typeof callee === 'object' &&
    callee !== null &&
    'type' in callee &&
    callee.type === 'MemberExpression' &&
    'object' in callee
    ? asCallExpression(callee.object)
    : undefined;
}

export function findCallChainMethod(
  expression: CallExpressionLike,
  methodName: string
): CallExpressionLike | undefined {
  if (getCalledMethodName(expression) === methodName) {
    return expression;
  }
  const chainedCall = getChainedCall(expression);
  return chainedCall ? findCallChainMethod(chainedCall, methodName) : undefined;
}

export function findCallChainBase(
  expression: CallExpressionLike
): CallExpressionLike {
  const chainedCall = getChainedCall(expression);
  return chainedCall ? findCallChainBase(chainedCall) : expression;
}

export function getStaticMiddlewareBindings(
  expression: CallExpressionLike
): readonly string[] | undefined {
  const middlewareCall = findCallChainMethod(expression, 'middleware');
  if (!middlewareCall) {
    return [];
  }
  const list = middlewareCall.arguments[0];
  if (
    typeof list !== 'object' ||
    list === null ||
    !('type' in list) ||
    list.type !== 'ArrayExpression' ||
    !('elements' in list) ||
    !Array.isArray(list.elements)
  ) {
    return undefined;
  }
  const bindings: string[] = [];
  for (const element of list.elements) {
    if (
      typeof element !== 'object' ||
      element === null ||
      !('type' in element) ||
      element.type !== 'Identifier' ||
      !('name' in element) ||
      typeof element.name !== 'string'
    ) {
      return undefined;
    }
    bindings.push(element.name);
  }
  return bindings;
}

type SyntaxNode = Record<string, unknown> & { readonly type: string };

function asSyntaxNode(value: unknown): SyntaxNode | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
    ? (value as SyntaxNode)
    : undefined;
}

function collectPatternBindings(value: unknown, bindings: Set<string>): void {
  const node = asSyntaxNode(value);
  if (!node) {
    return;
  }
  if (node.type === 'Identifier' && typeof node.name === 'string') {
    bindings.add(node.name);
    return;
  }
  if (node.type === 'RestElement') {
    collectPatternBindings(node.argument, bindings);
    return;
  }
  if (node.type === 'AssignmentPattern') {
    collectPatternBindings(node.left, bindings);
    return;
  }
  if (node.type === 'ArrayPattern' && Array.isArray(node.elements)) {
    for (const element of node.elements) {
      collectPatternBindings(element, bindings);
    }
    return;
  }
  if (node.type === 'ObjectPattern' && Array.isArray(node.properties)) {
    for (const propertyValue of node.properties) {
      const property = asSyntaxNode(propertyValue);
      if (!property) {
        continue;
      }
      collectPatternBindings(
        property.type === 'RestElement' ? property.argument : property.value,
        bindings
      );
    }
    return;
  }
  if (node.type === 'TSParameterProperty') {
    collectPatternBindings(node.parameter, bindings);
  }
}

function isFunctionNode(node: SyntaxNode): boolean {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  );
}

function collectFunctionScopedBindings(
  value: unknown,
  bindings: Set<string>
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFunctionScopedBindings(item, bindings);
    }
    return;
  }
  const node = asSyntaxNode(value);
  if (
    !node ||
    isFunctionNode(node) ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression'
  ) {
    return;
  }
  if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    for (const declarationValue of Array.isArray(node.declarations)
      ? node.declarations
      : []) {
      const declaration = asSyntaxNode(declarationValue);
      collectPatternBindings(declaration?.id, bindings);
    }
  }
  for (const [key, child] of Object.entries(node)) {
    if (!isSyntaxMetadataKey(key)) {
      collectFunctionScopedBindings(child, bindings);
    }
  }
}

function collectBlockBindings(
  statements: readonly unknown[],
  bindings: Set<string>
): void {
  for (const statementValue of statements) {
    const statement = asSyntaxNode(statementValue);
    if (!statement) {
      continue;
    }
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') {
      for (const declarationValue of Array.isArray(statement.declarations)
        ? statement.declarations
        : []) {
        const declaration = asSyntaxNode(declarationValue);
        collectPatternBindings(declaration?.id, bindings);
      }
    } else if (
      (statement.type === 'FunctionDeclaration' ||
        statement.type === 'ClassDeclaration') &&
      asSyntaxNode(statement.id)?.type === 'Identifier' &&
      typeof asSyntaxNode(statement.id)?.name === 'string'
    ) {
      bindings.add(asSyntaxNode(statement.id)?.name as string);
    }
  }
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

function isSyntaxMetadataKey(key: string): boolean {
  return (
    key === 'end' ||
    key === 'extra' ||
    key === 'loc' ||
    key === 'start' ||
    key === 'type'
  );
}

function isBound(
  name: string,
  scopes: readonly ReadonlySet<string>[]
): boolean {
  return scopes.some((scope) => scope.has(name));
}

function collectPatternReferences(
  value: unknown,
  scopes: readonly ReadonlySet<string>[],
  references: Set<string>
): void {
  const node = asSyntaxNode(value);
  if (!node) {
    return;
  }
  if (node.type === 'AssignmentPattern') {
    collectPatternReferences(node.left, scopes, references);
    collectFreeReferences(node.right, scopes, references);
    return;
  }
  if (node.type === 'RestElement') {
    collectPatternReferences(node.argument, scopes, references);
    return;
  }
  if (node.type === 'ArrayPattern' && Array.isArray(node.elements)) {
    for (const element of node.elements) {
      collectPatternReferences(element, scopes, references);
    }
    return;
  }
  if (node.type === 'ObjectPattern' && Array.isArray(node.properties)) {
    for (const propertyValue of node.properties) {
      const property = asSyntaxNode(propertyValue);
      if (!property) {
        continue;
      }
      if (property.computed) {
        collectFreeReferences(property.key, scopes, references);
      }
      collectPatternReferences(
        property.type === 'RestElement' ? property.argument : property.value,
        scopes,
        references
      );
    }
    return;
  }
  if (node.type === 'TSParameterProperty') {
    collectPatternReferences(node.parameter, scopes, references);
  }
}

function collectFunctionReferences(
  node: SyntaxNode,
  scopes: readonly ReadonlySet<string>[],
  references: Set<string>
): void {
  collectFreeReferences(node.decorators, scopes, references);
  if (
    (node.type === 'ObjectMethod' ||
      node.type === 'ClassMethod' ||
      node.type === 'ClassPrivateMethod') &&
    node.computed
  ) {
    collectFreeReferences(node.key, scopes, references);
  }

  const functionBindings = new Set<string>();
  if (
    (node.type === 'FunctionExpression' ||
      node.type === 'FunctionDeclaration') &&
    asSyntaxNode(node.id)?.type === 'Identifier' &&
    typeof asSyntaxNode(node.id)?.name === 'string'
  ) {
    functionBindings.add(asSyntaxNode(node.id)?.name as string);
  }
  const parameters = Array.isArray(node.params) ? node.params : [];
  for (const parameter of parameters) {
    collectPatternBindings(parameter, functionBindings);
  }
  collectFunctionScopedBindings(node.body, functionBindings);
  const functionScopes = [...scopes, functionBindings];
  for (const parameter of parameters) {
    collectPatternReferences(parameter, functionScopes, references);
  }
  collectFreeReferences(node.body, functionScopes, references);
}

function collectClassReferences(
  node: SyntaxNode,
  scopes: readonly ReadonlySet<string>[],
  references: Set<string>
): void {
  collectFreeReferences(node.decorators, scopes, references);
  collectFreeReferences(node.superClass, scopes, references);
  const classBindings = new Set<string>();
  if (
    asSyntaxNode(node.id)?.type === 'Identifier' &&
    typeof asSyntaxNode(node.id)?.name === 'string'
  ) {
    classBindings.add(asSyntaxNode(node.id)?.name as string);
  }
  collectFreeReferences(node.body, [...scopes, classBindings], references);
}

function collectFreeReferences(
  value: unknown,
  scopes: readonly ReadonlySet<string>[],
  references: Set<string>,
  parent?: Record<string, unknown>,
  key?: string
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFreeReferences(item, scopes, references, parent, key);
    }
    return;
  }
  const node = asSyntaxNode(value);
  if (!node) {
    return;
  }
  if (isFunctionNode(node)) {
    collectFunctionReferences(node, scopes, references);
    return;
  }
  if (node.type === 'BlockStatement') {
    const blockBindings = new Set<string>();
    const statements = Array.isArray(node.body) ? node.body : [];
    collectBlockBindings(statements, blockBindings);
    collectFreeReferences(statements, [...scopes, blockBindings], references);
    return;
  }
  if (node.type === 'CatchClause') {
    const catchBindings = new Set<string>();
    collectPatternBindings(node.param, catchBindings);
    const catchScopes = [...scopes, catchBindings];
    collectPatternReferences(node.param, catchScopes, references);
    collectFreeReferences(node.body, catchScopes, references);
    return;
  }
  if (
    node.type === 'ForStatement' ||
    node.type === 'ForInStatement' ||
    node.type === 'ForOfStatement'
  ) {
    const loopBindings = new Set<string>();
    const initializer = asSyntaxNode(
      node.type === 'ForStatement' ? node.init : node.left
    );
    if (
      initializer?.type === 'VariableDeclaration' &&
      initializer.kind !== 'var'
    ) {
      for (const declarationValue of Array.isArray(initializer.declarations)
        ? initializer.declarations
        : []) {
        collectPatternBindings(
          asSyntaxNode(declarationValue)?.id,
          loopBindings
        );
      }
    }
    const loopScopes = [...scopes, loopBindings];
    for (const childKey of [
      'init',
      'left',
      'right',
      'test',
      'update',
      'body',
    ]) {
      collectFreeReferences(
        node[childKey],
        loopScopes,
        references,
        node,
        childKey
      );
    }
    return;
  }
  if (node.type === 'SwitchStatement') {
    collectFreeReferences(node.discriminant, scopes, references);
    const switchBindings = new Set<string>();
    for (const caseValue of Array.isArray(node.cases) ? node.cases : []) {
      const switchCase = asSyntaxNode(caseValue);
      collectBlockBindings(
        Array.isArray(switchCase?.consequent) ? switchCase.consequent : [],
        switchBindings
      );
    }
    const switchScopes = [...scopes, switchBindings];
    for (const caseValue of Array.isArray(node.cases) ? node.cases : []) {
      const switchCase = asSyntaxNode(caseValue);
      collectFreeReferences(switchCase?.test, switchScopes, references);
      collectFreeReferences(switchCase?.consequent, switchScopes, references);
    }
    return;
  }
  if (node.type === 'VariableDeclarator') {
    collectPatternReferences(node.id, scopes, references);
    collectFreeReferences(node.init, scopes, references);
    return;
  }
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
    collectClassReferences(node, scopes, references);
    return;
  }
  if (
    node.type === 'Identifier' &&
    typeof node.name === 'string' &&
    !isBound(node.name, scopes) &&
    !isNonReferenceIdentifier(parent, key)
  ) {
    references.add(node.name);
  }
  for (const [childKey, child] of Object.entries(node)) {
    if (!isSyntaxMetadataKey(childKey)) {
      collectFreeReferences(child, scopes, references, node, childKey);
    }
  }
}

export function collectCallArgumentReferences(
  expression: CallExpressionLike
): ReadonlySet<string> {
  return collectLexicallyFreeReferences(expression.arguments);
}

export function collectLexicallyFreeReferences(
  value: unknown
): ReadonlySet<string> {
  const references = new Set<string>();
  collectFreeReferences(value, [], references);
  return references;
}

export function isStaticallySerializable(
  value: unknown,
  resolveIdentifier: (name: string) => unknown,
  seen: ReadonlySet<string> = new Set()
): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    return false;
  }
  if (
    value.type === 'StringLiteral' ||
    value.type === 'NumericLiteral' ||
    value.type === 'BooleanLiteral' ||
    value.type === 'NullLiteral' ||
    value.type === 'BigIntLiteral'
  ) {
    return true;
  }
  if (value.type === 'Identifier' && 'name' in value) {
    const name = value.name;
    if (typeof name !== 'string' || seen.has(name)) {
      return false;
    }
    return isStaticallySerializable(
      resolveIdentifier(name),
      resolveIdentifier,
      new Set([...seen, name])
    );
  }
  if (
    value.type === 'TemplateLiteral' &&
    'expressions' in value &&
    Array.isArray(value.expressions)
  ) {
    return value.expressions.length === 0;
  }
  if (
    value.type === 'ArrayExpression' &&
    'elements' in value &&
    Array.isArray(value.elements)
  ) {
    return value.elements.every(
      (element) =>
        element === null ||
        isStaticallySerializable(element, resolveIdentifier, seen)
    );
  }
  if (
    value.type === 'ObjectExpression' &&
    'properties' in value &&
    Array.isArray(value.properties)
  ) {
    return value.properties.every(
      (property) =>
        typeof property === 'object' &&
        property !== null &&
        'type' in property &&
        property.type === 'ObjectProperty' &&
        'computed' in property &&
        property.computed === false &&
        'value' in property &&
        isStaticallySerializable(property.value, resolveIdentifier, seen)
    );
  }
  return false;
}
