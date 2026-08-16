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

import { createParagraphPatch } from './paragraph-patch';

describe('createParagraphPatch', () => {
  it('patches a paragraph down to the empty string', () => {
    const dmp = new DiffMatchPatch();

    const { patch, nextOriginalText } = createParagraphPatch(dmp, 'abc', '');

    const [applied] = dmp.patch_apply(dmp.patch_fromText(patch), 'abc');
    expect(applied).toBe('');
    expect(nextOriginalText).toBe('');
  });

  it('treats an absent originalText as empty', () => {
    const dmp = new DiffMatchPatch();

    const { patch, nextOriginalText } = createParagraphPatch(dmp, undefined, 'abc');

    const [applied] = dmp.patch_apply(dmp.patch_fromText(patch), '');
    expect(applied).toBe('abc');
    expect(nextOriginalText).toBe('abc');
  });

  it('rejects an unset dirtyText', () => {
    const dmp = new DiffMatchPatch();

    expect(() => createParagraphPatch(dmp, 'abc', undefined)).toThrow('dirtyText is required');
  });
});
