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

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookCoreReadStore } from '@zeppelin/notebook-core';
import { DatasetType } from '@zeppelin/sdk';
import { mount } from './NotebookRouteEntry';

describe('NotebookRouteEntry', () => {
  const element = document.createElement('div');
  let unmount: (() => void) | undefined;

  afterEach(() => {
    if (unmount) {
      act(unmount);
      unmount = undefined;
    }
    element.replaceChildren();
  });

  it('reports readiness only after the host-owned Core publishes a loaded screen', () => {
    const store = new NotebookCoreReadStore('');
    const onReady = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady }).unmount;
    });
    expect(onReady).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Loading notebook');

    let request!: ReturnType<NotebookCoreReadStore['beginRoute']>;
    act(() => {
      request = store.beginRoute('note-1', null);
    });
    expect(onReady).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Loading notebook');
    act(() => {
      store.acceptNote(request, { id: 'note-1', name: 'Loaded note', path: '/Loaded note', paragraphs: [] });
    });
    expect(element.querySelector('h1')?.textContent).toBe('Loaded note');
    expect(onReady).toHaveBeenCalledOnce();
    act(() => {
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });
    expect(onReady).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('renders ordered saved paragraphs, permissions and results without write controls', () => {
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-1', 'revision-1');
    const savedParagraphs = [
      {
        id: 'paragraph-2',
        text: '%md second',
        status: 'FINISHED',
        title: 'Second',
        results: { msg: [{ type: DatasetType.TEXT, data: 'Saved output' }] }
      },
      { id: 'paragraph-1', text: '%md first', status: 'READY' }
    ];
    act(() => {
      unmount = mount(element, { core: store.port }).unmount;
      store.acceptRevision(request, {
        noteId: 'note-1',
        revisionId: 'revision-1',
        note: {
          id: 'note-1',
          name: 'Saved note',
          path: '/Saved note',
          paragraphs: savedParagraphs
        }
      });
      store.acceptPermissions(request, { owners: ['owner'], readers: ['reader'], writers: [], runners: [] });
    });

    expect(element.querySelector('h1')?.textContent).toBe('Saved note');
    expect(Array.from(element.querySelectorAll('article')).map(article => article.id)).toEqual([
      'paragraph-2',
      'paragraph-1'
    ]);
    expect(element.textContent).toContain('Saved output');
    expect(element.textContent).toContain('Revision: revision-1');
    expect(element.textContent).toContain('Readers: reader');
    expect(element.querySelector('button')).toBeNull();
    store.dispose();
  });
});
