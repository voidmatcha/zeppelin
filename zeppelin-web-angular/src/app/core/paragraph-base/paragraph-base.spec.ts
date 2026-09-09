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

import { ChangeDetectorRef } from '@angular/core';
import { Message, ParagraphItem } from '@zeppelin/sdk';
import { EMPTY } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ParagraphBase } from './paragraph-base';

class TestParagraph extends ParagraphBase {
  changeColWidth(): void {}
  updateParagraphResult(): void {}
}

const paragraphs: TestParagraph[] = [];

afterEach(() => {
  for (const paragraph of paragraphs.splice(0)) {
    paragraph.ngOnDestroy();
  }
});

const createParagraph = (text: string, dirtyText?: string): TestParagraph => {
  const paragraph = new TestParagraph(
    { receive: () => EMPTY } as unknown as Message,
    { isParagraphRunning: () => false, isEntireNoteRunning: () => false },
    {
      setContextValue: vi.fn(),
      unsetContextValue: vi.fn(),
      contextChanged: () => EMPTY,
      runParagraphAction: () => EMPTY
    },
    { markForCheck: vi.fn() } as unknown as ChangeDetectorRef
  );
  paragraph.paragraph = { text } as ParagraphItem;
  paragraph.originalText = 'previous save';
  paragraph.dirtyText = dirtyText;
  paragraphs.push(paragraph);
  return paragraph;
};

describe('ParagraphBase save responses', () => {
  it.each(['latest edit', ''])('preserves an unsaved edit %j when an earlier save responds', dirtyText => {
    const paragraph = createParagraph(dirtyText, dirtyText);

    paragraph.updateAllScopeTexts(paragraph.paragraph!, { text: 'previous save' } as ParagraphItem);

    expect(paragraph.paragraph?.text).toBe(dirtyText);
    expect(paragraph.dirtyText).toBe(dirtyText);
    expect(paragraph.originalText).toBe('previous save');
  });

  it('accepts a remote edit when there is no unsaved local edit', () => {
    const paragraph = createParagraph('previous save');

    paragraph.updateAllScopeTexts(paragraph.paragraph!, { text: 'remote edit' } as ParagraphItem);

    expect(paragraph.paragraph?.text).toBe('remote edit');
    expect(paragraph.originalText).toBe('remote edit');
    expect(paragraph.dirtyText).toBeUndefined();
  });
});
