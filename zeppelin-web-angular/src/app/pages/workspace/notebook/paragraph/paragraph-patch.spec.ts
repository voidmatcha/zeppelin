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

import { diff_match_patch as DiffMatchPatch } from 'diff-match-patch';
import { describe, expect, it } from 'vitest';

import { makeParagraphPatch } from './paragraph-patch';

describe('makeParagraphPatch', () => {
  it('builds a patch that clears the paragraph', () => {
    const dmp = new DiffMatchPatch();

    const { patch, originalText } = makeParagraphPatch(dmp, 'abc', '');

    // without this patch the collaborating client keeps the previous text
    expect(dmp.patch_apply(dmp.patch_fromText(patch), 'abc')[0]).toBe('');
    expect(originalText).toBe('');
  });

  it('rejects text that was never set', () => {
    expect(() => makeParagraphPatch(new DiffMatchPatch(), 'abc', undefined)).toThrow('dirtyText is required');
  });

  it('serializes multiple patch hunks without array separators', () => {
    const dmp = new DiffMatchPatch();
    const middle = 'unchanged '.repeat(20);
    const originalText = `before ${middle} after`;
    const dirtyText = `changed before ${middle} changed after`;

    const { patch } = makeParagraphPatch(dmp, originalText, dirtyText);

    expect(patch).not.toContain('\n,@@');
    expect(dmp.patch_apply(dmp.patch_fromText(patch), originalText)).toEqual([dirtyText, [true, true]]);
  });
});
