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

import { describe, expect, it } from 'vitest';

import { InterpreterBindingItem } from '@zeppelin/sdk';

import { findParagraphInterpreter } from './paragraph-interpreter';

const item = (id: string, name: string, selected: boolean, interpreters: string[]) =>
  ({
    id,
    name,
    selected,
    interpreters: interpreters.map(interpreter => ({ name: interpreter }))
  }) as unknown as InterpreterBindingItem;

const bindings = [
  item('s1', 'spark', true, ['spark', 'pyspark', 'sql']),
  item('p1', 'python', true, ['python']),
  item('m1', 'md', false, ['md'])
];

describe('findParagraphInterpreter', () => {
  it('runs a paragraph without a directive on the first bound setting', () => {
    expect(findParagraphInterpreter('print(1)', bindings)?.id).toBe('s1');
  });

  it('reads a lone %name as an interpreter of the default setting first', () => {
    expect(findParagraphInterpreter('%pyspark\n1', bindings)?.id).toBe('s1');
  });

  it('falls back to a setting of that name', () => {
    expect(findParagraphInterpreter('%python\n1', bindings)?.id).toBe('p1');
    expect(findParagraphInterpreter('%md hi', bindings)?.id).toBe('m1');
  });

  it('names both the setting and the interpreter with %setting.interpreter', () => {
    expect(findParagraphInterpreter('%spark.sql select 1', bindings)?.id).toBe('s1');
    expect(findParagraphInterpreter('%python.sql select 1', bindings)).toBeUndefined();
  });

  it('accepts %conf in every setting', () => {
    expect(findParagraphInterpreter('%conf\nx=1', bindings)?.id).toBe('s1');
  });

  it('finds nothing for an unknown interpreter', () => {
    expect(findParagraphInterpreter('%nothing', bindings)).toBeUndefined();
    expect(findParagraphInterpreter('print(1)', [])).toBeUndefined();
  });
});
