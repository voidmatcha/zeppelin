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
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NotebookCoreReadStore, NotebookCoreWireNote } from '@zeppelin/notebook-core';
import { ParagraphConfigResult } from '@zeppelin/sdk';
import { NotebookCoreReadComponent } from './notebook-core-read.component';
import { NotebookCoreReadHost } from './notebook-core-read-host';

describe('NotebookCoreReadComponent', () => {
  it('sends editable source changes through Core while blocking other collaborative actions', () => {
    const dispatch = vi.fn();
    const component = new NotebookCoreReadComponent({ markForCheck: vi.fn() } as unknown as ChangeDetectorRef);
    component.host = { commandPort: { dispatch } } as unknown as NotebookCoreReadHost;
    const textarea = document.createElement('textarea');
    textarea.value = 'local edit';

    component.editParagraph('p1', { target: textarea } as unknown as Event);
    component.saveParagraph('p1');
    component.runParagraph('p1');
    component.cancelParagraph('p1');
    expect(dispatch).not.toHaveBeenCalled();

    component.editable = true;
    component.editParagraph('p1', { target: textarea } as unknown as Event);
    component.saveParagraph('p1');
    component.runParagraph('p1');
    component.cancelParagraph('p1');
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'editParagraph', paragraphId: 'p1', text: 'local edit' });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'saveParagraph', paragraphId: 'p1' });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'runParagraph', paragraphId: 'p1' });
    expect(dispatch).toHaveBeenNthCalledWith(4, { type: 'cancelParagraph', paragraphId: 'p1' });
    component.state = {
      status: 'ready',
      acl: { status: 'loading' },
      data: {
        note: { id: 'note-1', name: 'Note', path: '/Note' },
        paragraphOrder: ['p1', 'p2'],
        paragraphsById: {
          p1: { id: 'p1', text: 'first', status: 'READY' },
          p2: { id: 'p2', text: 'second', status: 'READY' }
        }
      }
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.insertParagraph(1);
    component.moveParagraph('p1', 1);
    component.removeParagraph('p1');
    expect(dispatch).toHaveBeenNthCalledWith(5, { type: 'insertParagraph', index: 1 });
    expect(dispatch).toHaveBeenNthCalledWith(6, { type: 'moveParagraph', paragraphId: 'p1', index: 1 });
    expect(dispatch).toHaveBeenNthCalledWith(7, { type: 'removeParagraph', paragraphId: 'p1' });

    component.collaborationBlocked = true;
    expect(component.canWrite).toBe(false);
    component.editParagraph('p1', { target: textarea } as unknown as Event);
    component.saveParagraph('p1');
    component.runParagraph('p1');
    component.cancelParagraph('p1');
    component.insertParagraph(1);
    component.moveParagraph('p1', 1);
    component.removeParagraph('p1');
    expect(dispatch).toHaveBeenCalledTimes(8);
    expect(dispatch).toHaveBeenNthCalledWith(8, { type: 'editParagraph', paragraphId: 'p1', text: 'local edit' });
    component.collaborationBlocked = false;

    component.revisionId = 'saved-revision';
    expect(component.canEdit).toBe(false);
    component.editParagraph('p1', { target: textarea } as unknown as Event);
    component.saveParagraph('p1');
    component.runParagraph('p1');
    component.cancelParagraph('p1');
    component.insertParagraph(1);
    component.moveParagraph('p1', 1);
    component.removeParagraph('p1');
    expect(dispatch).toHaveBeenCalledTimes(8);
    vi.restoreAllMocks();
  });

  it('passes a mutable copy of saved chart config to the Angular renderer', () => {
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-1', null);
    store.acceptNote(request, {
      id: 'note-1',
      name: 'Saved note',
      path: '/Saved note',
      paragraphs: [
        {
          id: 'paragraph-1',
          text: '%sh saved',
          status: 'FINISHED',
          config: { results: { 0: { graph: { mode: 'multiBarChart', keys: [], groups: [], values: [] } } } },
          results: { msg: [{ type: 'TABLE', data: 'city\tvalue\nSeoul\t2' }] }
        }
      ]
    } as unknown as NotebookCoreWireNote);
    store.acceptPermissions(request, { owners: ['owner'], readers: [], writers: [], runners: [] });
    const component = new NotebookCoreReadComponent({ markForCheck: vi.fn() } as unknown as ChangeDetectorRef);
    component.host = { snapshot$: of(store.getSnapshot()) } as NotebookCoreReadHost;
    component.ngOnInit();

    const saved = (component.paragraph('paragraph-1')?.config as { results: Record<string, ParagraphConfigResult> })
      .results[0];
    const rendered = component.resultConfig('paragraph-1', 0);
    expect(component.state.acl).toMatchObject({ status: 'ready', permissions: { owners: ['owner'] } });
    expect(rendered?.graph.mode).toBe('multiBarChart');
    expect(rendered).not.toBe(saved);
    expect(component.resultConfig('paragraph-1', 0)).toBe(rendered);
    rendered!.graph.mode = 'table';
    expect(saved?.graph.mode).toBe('multiBarChart');

    component.ngOnDestroy();
    store.dispose();
  });
});
