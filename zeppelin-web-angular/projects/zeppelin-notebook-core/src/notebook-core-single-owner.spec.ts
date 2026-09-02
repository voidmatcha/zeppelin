// @vitest-environment node

/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const componentPath = resolve(process.cwd(), 'src/app/pages/workspace/notebook/notebook.component.ts');

const assignmentOperators = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken
]);

const mutatingArrayMethods = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift'
]);

const isParagraphsProperty = (node: ts.Node): node is ts.PropertyAccessExpression =>
  ts.isPropertyAccessExpression(node) && node.name.text === 'paragraphs';

const findParagraphCollectionMutations = (method: ts.MethodDeclaration): string[] => {
  const mutations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      assignmentOperators.has(node.operatorToken.kind) &&
      isParagraphsProperty(node.left)
    ) {
      mutations.push(node.getText());
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      mutatingArrayMethods.has(node.expression.name.text) &&
      isParagraphsProperty(node.expression.expression)
    ) {
      mutations.push(node.getText());
    }

    ts.forEachChild(node, visit);
  };

  method.body && visit(method.body);
  return mutations;
};

describe('notebook paragraph collection ownership', () => {
  it('keeps add, remove, and move handlers from mutating Angular paragraph membership or order directly', () => {
    const source = ts.createSourceFile(
      componentPath,
      readFileSync(componentPath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const targetMethods = new Set(['addParagraph', 'removeParagraph', 'moveParagraph']);
    const checkedMethods = new Set<string>();
    const mutations: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && targetMethods.has(node.name.text)) {
        checkedMethods.add(node.name.text);
        mutations.push(
          ...findParagraphCollectionMutations(node).map(mutation => `${node.name.getText()}: ${mutation}`)
        );
      }
      ts.forEachChild(node, visit);
    };

    visit(source);

    expect([...checkedMethods].sort()).toEqual([...targetMethods].sort());
    expect(mutations).toEqual([]);
  });
});
