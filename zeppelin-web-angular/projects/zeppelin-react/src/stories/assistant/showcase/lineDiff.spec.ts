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
import { diffLines } from './lineDiff';

describe('diffLines', () => {
  it('marks a changed line as removed then added, keeping both sides numbered', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a', before: 1, after: 1 },
      { kind: 'removed', text: 'b', before: 2 },
      { kind: 'added', text: 'B', after: 2 },
      { kind: 'same', text: 'c', before: 3, after: 3 }
    ]);
  });

  it('handles lines added at the end and removed at the start', () => {
    expect(diffLines('x\ny', 'y\nz').map(line => `${line.kind}:${line.text}`)).toEqual([
      'removed:x',
      'same:y',
      'added:z'
    ]);
  });

  it('reports no change for identical text', () => {
    expect(diffLines('one\ntwo', 'one\ntwo').every(line => line.kind === 'same')).toBe(true);
  });
});
