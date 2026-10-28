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
import { Message, ParagraphItem, textChecksum } from '@zeppelin/sdk';
import { EMPTY } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AngularContextManager } from '../../../../core/paragraph-base/angular-context-manager';
import { ParagraphBase } from '../../../../core/paragraph-base/paragraph-base';
import { NotebookParagraphComponent } from './paragraph.component';

vi.mock('@zeppelin/services', () => ({
  HeliumService: class {},
  MessageService: class {},
  NgZService: class {},
  NoteStatusService: class {},
  NoteVarShareService: class {},
  ShortcutService: class {}
}));
vi.mock('../../share/result/result.component', () => ({ NotebookParagraphResultComponent: class {} }));
vi.mock('./code-editor/code-editor.component', () => ({ NotebookParagraphCodeEditorComponent: class {} }));

class SaveTestParagraph extends ParagraphBase {
  protected currentNoteId = 'note';
  changeColWidth(): void {}
  updateParagraphResult(): void {}
}
const instances: SaveTestParagraph[] = [];
afterEach(() => {
  for (const instance of instances.splice(0)) instance.ngOnDestroy();
});
const createSaveTestParagraph = (text: string, dirtyText: string) => {
  const instance = new SaveTestParagraph(
    { receive: () => EMPTY, receiveEnvelope: () => EMPTY } as unknown as Message,
    { isParagraphRunning: () => false, isEntireNoteRunning: () => false },
    {} as AngularContextManager,
    { markForCheck: vi.fn() } as unknown as ChangeDetectorRef
  );
  instance.paragraph = { id: 'A', text, config: {}, settings: { params: {} } } as ParagraphItem;
  instance.dirtyText = dirtyText;
  instances.push(instance);
  return instance;
};

describe('checksum-guarded paragraph commits', () => {
  it.each([
    { description: 'a new draft', edits: ['later edit'] },
    { description: 'an edit returning to the submitted text', edits: ['later edit', 'diverged text'] }
  ])('preserves $description after collaborative mode ends while a commit is pending', ({ edits }) => {
    const paragraph = createSaveTestParagraph('diverged text', 'diverged text');
    paragraph.originalText = 'diverged text';
    const startSaveTimer = vi.fn();
    Object.assign(paragraph, { note: { id: 'note' }, collaborativeMode: true, startSaveTimer });
    paragraph.messageService.commitParagraph = vi.fn().mockReturnValue('rejected-save');
    const component = paragraph as unknown as NotebookParagraphComponent;

    NotebookParagraphComponent.prototype.commitParagraph.call(component);
    // Another client leaves. Subsequent edits wait for the non-collaborative save timer
    // rather than sending a patch and advancing originalText.
    component.collaborativeMode = false;
    for (const edit of edits) {
      NotebookParagraphComponent.prototype.textChanged.call(component, edit);
    }
    expect(startSaveTimer).toHaveBeenCalled();
    expect(paragraph.originalText).toBe('diverged text');

    paragraph.updateAllScopeTexts(paragraph.paragraph!, { text: 'server text' } as ParagraphItem, 'rejected-save');

    expect(paragraph.paragraph?.text).toBe(edits.at(-1));
    expect(paragraph.dirtyText).toBe(edits.at(-1));
    // Retaining the draft must not give the rejected text a valid server checksum.
    expect(paragraph.originalText).toBe('diverged text');
  });

  it('sends recovered text when committing again after a checksum rejection', () => {
    const paragraph = createSaveTestParagraph('diverged text', 'diverged text');
    paragraph.originalText = 'diverged text';
    Object.assign(paragraph, { note: { id: 'note' }, collaborativeMode: true });
    const commitParagraph = vi.fn().mockReturnValueOnce('rejected-save').mockReturnValueOnce('next-save');
    paragraph.messageService.commitParagraph = commitParagraph;
    const commit = () =>
      NotebookParagraphComponent.prototype.commitParagraph.call(paragraph as unknown as NotebookParagraphComponent);

    commit();
    expect(commitParagraph.mock.calls[0][2]).toBe('diverged text');
    expect(commitParagraph.mock.calls[0][6]).toBe(textChecksum('diverged text'));
    // The server rejects the different base and replies with the paragraph it still holds.
    paragraph.updateAllScopeTexts(paragraph.paragraph!, { text: 'server text' } as ParagraphItem, 'rejected-save');
    commit();

    expect(commitParagraph.mock.calls[1][2]).toBe('server text');
    expect(commitParagraph.mock.calls[1][6]).toBe(textChecksum('server text'));
  });
});
