// @vitest-environment node

/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
const zeppelinWebAngularRoot = resolve(sourceRoot, '../../..');
const reactNotebookCoreBoundaryFiles = [
  resolve(zeppelinWebAngularRoot, 'projects/zeppelin-react/src/main.ts'),
  resolve(zeppelinWebAngularRoot, 'projects/zeppelin-react/src/notebookCoreContract.ts')
];
const forbiddenModulePrefixes = [
  '@angular/',
  '@zeppelin/sdk',
  'react',
  'react-dom',
  'react-redux',
  'react-router',
  'react-router-dom',
  'rxjs',
  'axios'
];
const forbiddenReactNotebookCoreConsumerModulePrefixes = [
  '@angular/common/http',
  '@zeppelin/sdk',
  'axios',
  'rxjs/webSocket'
];
const forbiddenGlobals = new Set(['fetch', 'WebSocket', 'XMLHttpRequest']);
const transportGlobalOwners = new Set(['globalThis', 'window']);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return isCheckedSourceFile(path) ? [path] : [];
  });

const checkedSourceExtensions = ['.ts', '.tsx', '.mts', '.cts'];

const isCheckedSourceFile = (path: string): boolean => {
  return checkedSourceExtensions.some(extension => path.endsWith(extension)) && !/\.spec\.[cm]?tsx?$/.test(path);
};

describe('notebook core import boundary', () => {
  it('stays framework-neutral and transport-neutral', () => {
    const violations = sourceFiles(sourceRoot).flatMap(path => {
      const source = readFileSync(path, 'utf8');
      return findViolations(path, source);
    });

    expect(violations).toEqual([]);
  });

  it('keeps the React notebook core adapter independent from Zeppelin transport implementations', () => {
    const violations = reactNotebookCoreBoundaryFiles.flatMap(path => {
      const source = readFileSync(path, 'utf8');
      return findViolations(path, source, forbiddenReactNotebookCoreConsumerModulePrefixes);
    });

    expect(formatViolations(violations)).toEqual([]);
  });

  it('ignores forbidden words in comments and string values', () => {
    const source = `// React may render this later.\nexport const note = 'fetch over WebSocket';`;

    expect(findViolations('comment-fixture.ts', source)).toEqual([]);
  });

  it('rejects static, dynamic and direct transport dependencies', () => {
    const source = [
      `import type { OP } from '@zeppelin/sdk';`,
      `export { useMemo } from 'react';`,
      `type LeakedMessage = import('@zeppelin/sdk').Message;`,
      `import { createRoot } from 'react-dom/client';`,
      `import { Provider } from 'react-redux';`,
      `const router = () => import('react-router-dom');`,
      `const load = () => import('rxjs/operators');`,
      `const request = () => fetch('/api/notebook');`,
      `const socket = new globalThis.WebSocket('/ws');`,
      `const xhr = new window.XMLHttpRequest();`
    ].join('\n');

    expect(findViolations('violation-fixture.ts', source)).toEqual([
      'violation-fixture.ts: import @zeppelin/sdk',
      'violation-fixture.ts: import react',
      'violation-fixture.ts: import @zeppelin/sdk',
      'violation-fixture.ts: import react-dom/client',
      'violation-fixture.ts: import react-redux',
      'violation-fixture.ts: import react-router-dom',
      'violation-fixture.ts: import rxjs/operators',
      'violation-fixture.ts: global fetch',
      'violation-fixture.ts: global WebSocket',
      'violation-fixture.ts: global XMLHttpRequest'
    ]);
  });
});

const findViolations = (
  path: string,
  source: string,
  forbiddenPrefixes: readonly string[] = forbiddenModulePrefixes
): string[] => {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, getScriptKind(path));
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    const moduleSpecifier = getModuleSpecifier(node);
    if (moduleSpecifier && forbiddenPrefixes.some(prefix => matchesModulePrefix(moduleSpecifier, prefix))) {
      violations.push(`${path}: import ${moduleSpecifier}`);
    }

    const forbiddenGlobal = getForbiddenTransportGlobalName(node);
    if (forbiddenGlobal) {
      violations.push(`${path}: global ${forbiddenGlobal}`);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const formatViolations = (violations: readonly string[]): string[] => {
  return violations.map(violation => violation.replace(`${zeppelinWebAngularRoot}/`, ''));
};

const getScriptKind = (path: string): ts.ScriptKind => {
  if (path.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
};

const getModuleSpecifier = (node: ts.Node): string | null => {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    return node.argument.literal.text;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return expression && ts.isStringLiteral(expression) ? expression.text : null;
  }
  if (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0]) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  ) {
    return node.arguments[0].text;
  }
  return null;
};

const matchesModulePrefix = (moduleSpecifier: string, prefix: string): boolean => {
  return moduleSpecifier === prefix || moduleSpecifier.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
};

const isRuntimeIdentifier = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  return !(
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isTypeReferenceNode(parent) && parent.typeName === node)
  );
};

const getForbiddenTransportGlobalName = (node: ts.Node): string | null => {
  if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text) && isRuntimeIdentifier(node)) {
    return node.text;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.name) &&
    forbiddenGlobals.has(node.name.text) &&
    ts.isIdentifier(node.expression) &&
    transportGlobalOwners.has(node.expression.text)
  ) {
    return node.name.text;
  }
  return null;
};
