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

import {
  findNotebookMatches,
  NotebookSearchSession,
  replaceAllNotebookMatches,
  replaceNotebookMatch
} from './notebook-search';

describe('notebook-wide literal search and replace', () => {
  it('finds non-overlapping matches in notebook order', () => {
    expect(
      findNotebookMatches(
        [
          { id: 'a', text: 'aaaa' },
          { id: 'b', text: 'aa' }
        ],
        'aa'
      )
    ).toEqual([
      { paragraphId: 'a', offset: 0 },
      { paragraphId: 'a', offset: 2 },
      { paragraphId: 'b', offset: 0 }
    ]);
  });

  it('ignores an empty search term', () => {
    expect(findNotebookMatches([{ id: 'a', text: 'abc' }], '')).toEqual([]);
    expect(replaceAllNotebookMatches('abc', '', 'x')).toBe('abc');
  });

  it('replaces only the selected match and rejects stale offsets', () => {
    expect(replaceNotebookMatch('one one', 'one', 'two', 4)).toBe('one two');
    expect(replaceNotebookMatch('one one', 'one', 'two', 2)).toBe('one one');
  });

  it('replaces every literal match without treating special characters as a regex', () => {
    expect(replaceAllNotebookMatches('a.b a.b', 'a.b', '$&')).toBe('$& $&');
  });

  it('navigates between paragraphs in both directions with wraparound', () => {
    const session = new NotebookSearchSession();
    const paragraphs = [
      { id: 'a', text: 'one one' },
      { id: 'b', text: 'one' }
    ];
    session.setTerm('one');

    expect(session.next(paragraphs, 1)).toEqual({ paragraphId: 'a', offset: 0 });
    expect(session.next(paragraphs, 1)).toEqual({ paragraphId: 'a', offset: 4 });
    expect(session.next(paragraphs, 1)).toEqual({ paragraphId: 'b', offset: 0 });
    expect(session.next(paragraphs, 1)).toEqual({ paragraphId: 'a', offset: 0 });
    expect(session.next(paragraphs, -1)).toEqual({ paragraphId: 'b', offset: 0 });
  });

  it('replaces the selected occurrence and selects the next remaining match', () => {
    const session = new NotebookSearchSession();
    const paragraphs = [
      { id: 'a', text: 'one one' },
      { id: 'b', text: 'one' }
    ];
    session.setTerm('one');
    session.next(paragraphs, 1);

    expect(session.replaceCurrent(paragraphs, 'three')).toEqual({
      paragraphId: 'a',
      text: 'three one',
      nextMatch: { paragraphId: 'a', offset: 6 }
    });
  });

  it('replaces only changed paragraphs and resets the active match', () => {
    const session = new NotebookSearchSession();
    const paragraphs = [
      { id: 'a', text: 'one one' },
      { id: 'b', text: 'two' }
    ];
    session.setTerm('one');
    session.next(paragraphs, 1);

    expect(session.replaceAll(paragraphs, 'three')).toEqual([{ id: 'a', text: 'three three' }]);
    expect(
      session.next(
        [
          { id: 'a', text: 'three three' },
          { id: 'b', text: 'two' }
        ],
        1
      )
    ).toBeNull();
  });
});
