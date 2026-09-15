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

import { SimpleChange } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { preserveExistingParagraphViews, shouldHydrateParagraphInput } from './paragraph-input-change';

describe('paragraph input hydration', () => {
  it('preserves streaming state when Core projects the same paragraph', () => {
    const previous = { id: 'paragraph', results: [] };
    const current = { ...previous, text: 'local draft' };

    expect(shouldHydrateParagraphInput({ paragraph: new SimpleChange(previous, current, false) })).toBe(false);
  });

  it('hydrates a different paragraph', () => {
    expect(
      shouldHydrateParagraphInput({
        paragraph: new SimpleChange({ id: 'previous' }, { id: 'current' }, false)
      })
    ).toBe(true);
  });

  it('hydrates a new note even when its paragraph ID is unchanged', () => {
    expect(
      shouldHydrateParagraphInput({
        paragraph: new SimpleChange({ id: 'paragraph' }, { id: 'paragraph' }, false),
        note: new SimpleChange({ id: 'previous' }, { id: 'current' }, false)
      })
    ).toBe(true);
  });
});

describe('structural paragraph projection', () => {
  it('reorders existing live views and uses projected views only for new paragraphs', () => {
    const current = [
      { id: 'first', text: 'local draft', results: ['streamed output'] },
      { id: 'second', text: 'second' }
    ];
    const added = { id: 'added', text: 'added' };
    const projected = [added, { id: 'first', text: 'stale server text', results: [] }, current[1]];

    const result = preserveExistingParagraphViews(current, projected);

    expect(result).toEqual([added, current[0], current[1]]);
    expect(result[1]).toBe(current[0]);
  });
});
