/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseDataTypeMapOperations,
  parseJavaOperations,
  parseTypeScriptOperations,
  NOTEBOOK_SCOPED_REPLY_PAIRS,
  validateContract
} = require('./check-websocket-contract');

test('parses simple Java enum constants while ignoring comments', () => {
  const operations = parseJavaOperations(`
    public class Message {
      public enum OP {
        FIRST, // a comment containing },
        /* another comment containing }, */ SECOND,
        THIRD,
      }
    }
  `);

  assert.deepEqual([...operations], ['FIRST', 'SECOND', 'THIRD']);
});

test('accepts an optional Java enum semicolon', () => {
  const operations = parseJavaOperations('public enum OP { FIRST, SECOND; }');

  assert.deepEqual([...operations], ['FIRST', 'SECOND']);
});

test('fails closed for unsupported or malformed Java enum declarations', () => {
  assert.throws(() => parseJavaOperations('public enum OP { FIRST,,SECOND }'), /contains an empty operation/);
  assert.throws(
    () => parseJavaOperations('public enum OP { FIRST("value") }'),
    /must contain only simple enum constants/
  );
  assert.throws(() => parseJavaOperations('public enum OP { FIRST, \/\* unclosed'), /unclosed block comment/);
  assert.throws(
    () => parseJavaOperations('public enum OP { FIRST }\npublic enum OP { SECOND }'),
    /Expected exactly one public enum OP/
  );
});

test('classifies frontend-only TypeScript operations from inline JSDoc', () => {
  const operations = parseTypeScriptOperations(`
    export enum OP {
      WIRE = 'WIRE',
      /** @frontendOnly Emitted locally without using the websocket. */
      LOCAL = 'LOCAL'
    }
  `);

  assert.deepEqual([...operations.wireOperations], ['WIRE']);
  assert.deepEqual([...operations.frontendOnlyOperations], ['LOCAL']);
});

test('requires valid TypeScript wire values and frontend-only explanations', () => {
  assert.throws(
    () => parseTypeScriptOperations("export enum OP { FIRST = 'SECOND' }"),
    /must use the wire value 'FIRST'/
  );
  assert.throws(
    () =>
      parseTypeScriptOperations(`
        export enum OP {
          /** @frontendOnly */
          LOCAL = 'LOCAL'
        }
      `),
    /must explain why it is @frontendOnly/
  );
});

test('compares Java and TypeScript operation sets without requiring the same order', () => {
  const notebookScopedOperations = [...new Set(NOTEBOOK_SCOPED_REPLY_PAIRS.flat())];
  const javaOperations = new Set(['FIRST', 'SECOND', ...notebookScopedOperations]);
  const typeScriptOperations = parseTypeScriptOperations(`
    export enum OP {
      SECOND = 'SECOND',
      FIRST = 'FIRST',
      GET_INTERPRETER_BINDINGS = 'GET_INTERPRETER_BINDINGS',
      INTERPRETER_BINDINGS = 'INTERPRETER_BINDINGS',
      SAVE_INTERPRETER_BINDINGS = 'SAVE_INTERPRETER_BINDINGS',
      CHECKPOINT_NOTE = 'CHECKPOINT_NOTE',
      LIST_REVISION_HISTORY = 'LIST_REVISION_HISTORY',
      SET_NOTE_REVISION = 'SET_NOTE_REVISION',
      /** @frontendOnly Emitted locally without using the websocket. */
      LOCAL = 'LOCAL'
    }
  `);
  const dataTypeMaps = `
    interface MessageSendDataTypeMap {
      [OP.FIRST]: undefined;
      [OP.GET_INTERPRETER_BINDINGS]: undefined;
      [OP.SAVE_INTERPRETER_BINDINGS]: undefined;
      [OP.CHECKPOINT_NOTE]: undefined;
      [OP.LIST_REVISION_HISTORY]: undefined;
      [OP.SET_NOTE_REVISION]: undefined;
    }
    interface MessageReceiveDataTypeMap {
      [OP.SECOND]: undefined;
      [OP.LOCAL]: undefined;
      [OP.INTERPRETER_BINDINGS]: undefined;
      [OP.LIST_REVISION_HISTORY]: undefined;
      [OP.SET_NOTE_REVISION]: undefined;
    }
  `;
  const sendOperations = parseDataTypeMapOperations(dataTypeMaps, 'MessageSendDataTypeMap');
  const receiveOperations = parseDataTypeMapOperations(dataTypeMaps, 'MessageReceiveDataTypeMap');

  assert.doesNotThrow(() => validateContract(javaOperations, typeScriptOperations, sendOperations, receiveOperations));
});

test('reports operation drift and rejects frontend-only send operations', () => {
  const javaOperations = new Set(['FIRST', 'MISSING', ...new Set(NOTEBOOK_SCOPED_REPLY_PAIRS.flat())]);
  const typeScriptOperations = parseTypeScriptOperations(`
    export enum OP {
      FIRST = 'FIRST',
      EXTRA = 'EXTRA',
      GET_INTERPRETER_BINDINGS = 'GET_INTERPRETER_BINDINGS',
      INTERPRETER_BINDINGS = 'INTERPRETER_BINDINGS',
      SAVE_INTERPRETER_BINDINGS = 'SAVE_INTERPRETER_BINDINGS',
      CHECKPOINT_NOTE = 'CHECKPOINT_NOTE',
      LIST_REVISION_HISTORY = 'LIST_REVISION_HISTORY',
      SET_NOTE_REVISION = 'SET_NOTE_REVISION',
      /** @frontendOnly Emitted locally without using the websocket. */
      LOCAL = 'LOCAL'
    }
  `);

  assert.throws(
    () => validateContract(javaOperations, typeScriptOperations, new Set(), new Set(['LOCAL'])),
    /missing from TypeScript=\[MISSING\], extra in TypeScript=\[EXTRA\]/
  );

  const matchingTypeScriptOperations = parseTypeScriptOperations(`
    export enum OP {
      FIRST = 'FIRST',
      MISSING = 'MISSING',
      GET_INTERPRETER_BINDINGS = 'GET_INTERPRETER_BINDINGS',
      INTERPRETER_BINDINGS = 'INTERPRETER_BINDINGS',
      SAVE_INTERPRETER_BINDINGS = 'SAVE_INTERPRETER_BINDINGS',
      CHECKPOINT_NOTE = 'CHECKPOINT_NOTE',
      LIST_REVISION_HISTORY = 'LIST_REVISION_HISTORY',
      SET_NOTE_REVISION = 'SET_NOTE_REVISION',
      /** @frontendOnly Emitted locally without using the websocket. */
      LOCAL = 'LOCAL'
    }
  `);
  const requiredSendOperations = new Set([
    'LOCAL',
    ...NOTEBOOK_SCOPED_REPLY_PAIRS.map(([requestOperation]) => requestOperation)
  ]);
  const requiredReceiveOperations = new Set([
    'LOCAL',
    ...NOTEBOOK_SCOPED_REPLY_PAIRS.map(([, responseOperation]) => responseOperation)
  ]);
  assert.throws(
    () => validateContract(javaOperations, matchingTypeScriptOperations, requiredSendOperations, requiredReceiveOperations),
    /Frontend-only operation LOCAL cannot be in MessageSendDataTypeMap/
  );
});

test('keeps notebook-scoped reply correlation operations inventoried', () => {
  assert.deepEqual(NOTEBOOK_SCOPED_REPLY_PAIRS, [
    ['GET_INTERPRETER_BINDINGS', 'INTERPRETER_BINDINGS'],
    ['SAVE_INTERPRETER_BINDINGS', 'INTERPRETER_BINDINGS'],
    ['CHECKPOINT_NOTE', 'LIST_REVISION_HISTORY'],
    ['LIST_REVISION_HISTORY', 'LIST_REVISION_HISTORY'],
    ['SET_NOTE_REVISION', 'SET_NOTE_REVISION']
  ]);
});
