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
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookCoreReadStore, NotebookCoreWireNote } from '@zeppelin/notebook-core';
import { DatasetType } from '@zeppelin/sdk';
import { mount } from './NotebookRouteEntry';

const { chartConfigurations } = vi.hoisted(() => ({ chartConfigurations: [] as unknown[] }));

vi.mock('chart.js/auto', () => ({
  Chart: class {
    static defaults = { color: '', borderColor: '' };
    constructor(_context: unknown, configuration: unknown) {
      chartConfigurations.push(configuration);
    }
    destroy() {}
  }
}));

describe('NotebookRouteEntry', () => {
  const element = document.createElement('div');
  let unmount: (() => void) | undefined;

  afterEach(() => {
    if (unmount) {
      act(unmount);
      unmount = undefined;
    }
    element.replaceChildren();
    chartConfigurations.length = 0;
    window.location.hash = '';
    vi.restoreAllMocks();
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
    expect(onReady).not.toHaveBeenCalled();
    act(() => {
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });
    expect(onReady).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('does not report a failed note or unavailable permissions as ready', () => {
    const store = new NotebookCoreReadStore('');
    const onReady = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady }).unmount;
    });
    let request = store.beginRoute('missing', null);
    act(() => {
      store.acceptNoteFailure(request, 'notFound');
    });
    expect(element.textContent).toContain('Notebook not found');
    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      request = store.beginRoute('note-1', null);
      store.acceptNote(request, { id: 'note-1', name: 'Loaded note', path: '/Loaded note', paragraphs: [] });
      store.acceptPermissionsFailure(request, 'failed');
    });
    expect(element.textContent).toContain('Could not load permissions');
    expect(onReady).not.toHaveBeenCalled();
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

  it('edits through the host-owned command port only in the private editor preview', () => {
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-1', null);
    const dispatch = vi.fn(store.dispatch.bind(store));
    const commandPort = Object.freeze({ ...store.port, dispatch });
    act(() => {
      unmount = mount(element, { core: store.port, commandPort }).unmount;
      store.acceptNote(request, {
        id: 'note-1',
        name: 'Editable note',
        path: '/Editable note',
        paragraphs: [
          { id: 'p1', text: 'initial', status: 'READY', config: { editorHide: true } },
          { id: 'p2', text: 'second', status: 'READY', config: { editorHide: true } }
        ]
      } as unknown as NotebookCoreWireNote);
      store.acceptPermissions(request, { owners: [], readers: [], writers: ['editor'], runners: [] });
    });

    const editor = element.querySelector('textarea');
    expect(editor?.value).toBe('initial');
    act(() => fireEvent.change(editor!, { target: { value: 'local edit' } }));
    expect(store.getSnapshot().draftsById?.p1.text).toBe('local edit');
    expect(editor?.value).toBe('local edit');
    act(() =>
      fireEvent.click(
        Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Save paragraph')!
      )
    );
    expect(store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' })).toEqual({ accepted: false });
    act(() =>
      fireEvent.click(
        Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Add paragraph below')!
      )
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'insertParagraph', index: 1 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() =>
      fireEvent.click(
        Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Remove paragraph')!
      )
    );
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'removeParagraph', paragraphId: 'p1' });
    confirm.mockReturnValue(true);
    act(() =>
      fireEvent.click(
        Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Remove paragraph')!
      )
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'removeParagraph', paragraphId: 'p1' });
    act(() =>
      fireEvent.click(
        Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Run paragraph')!
      )
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'runParagraph', paragraphId: 'p1' });
    act(() => {
      store.acceptParagraphEvent(request, {
        type: 'update',
        noteId: 'note-1',
        sequence: 1,
        paragraph: { id: 'p1', text: 'initial', status: 'RUNNING' }
      });
    });
    act(() =>
      fireEvent.click(
        Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Cancel paragraph')!
      )
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'cancelParagraph', paragraphId: 'p1' });
    confirm.mockRestore();
    store.dispose();
  });

  it('allows collaborative source edits while keeping other notebook actions unavailable', () => {
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-1', null);
    const dispatch = vi.fn(store.dispatch.bind(store));
    act(() => {
      unmount = mount(element, { core: store.port, commandPort: { ...store.port, dispatch } }).unmount;
      store.acceptNote(request, {
        id: 'note-1',
        name: 'Shared note',
        path: '/Shared note',
        paragraphs: [{ id: 'p1', text: 'saved', status: 'READY' }]
      });
      store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'unsaved' });
      store.acceptCollaborativeStatus(request, { noteId: 'note-1', sequence: 1, status: true });
    });
    expect(element.querySelector('textarea')?.value).toBe('unsaved');
    expect(element.querySelector('textarea')?.readOnly).toBe(false);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Collaborative editing');
    expect(Array.from(element.querySelectorAll('button')).every(button => button.disabled)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    act(() => {
      store.acceptPatchEvent(request, {
        noteId: 'note-1',
        paragraphId: 'p1',
        sequence: 2,
        baseText: 'saved',
        text: 'shared',
        applied: true
      });
    });
    expect(element.textContent).toContain('without checksums');
    expect(element.querySelector('textarea')?.value).toBe('unsaved');
    store.dispose();
  });

  it('keeps a saved revision read-only even when an edit command port is available', () => {
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-1', 'revision-1');
    const commandPort = Object.freeze({ ...store.port, dispatch: store.dispatch.bind(store) });
    act(() => {
      unmount = mount(element, { core: store.port, commandPort }).unmount;
      store.acceptRevision(request, {
        noteId: 'note-1',
        revisionId: 'revision-1',
        note: {
          id: 'note-1',
          name: 'Saved note',
          path: '/Saved note',
          paragraphs: [{ id: 'p1', text: 'saved', status: 'READY' }]
        }
      });
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });
    expect(element.querySelector('textarea')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('main')?.getAttribute('aria-label')).toBe('Read-only notebook');
    store.dispose();
  });

  it('does not report a saved chart ready when its canvas cannot be rendered', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-chart', null);
    const onReady = vi.fn();
    const onError = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady, onError }).unmount;
      store.acceptNote(request, {
        id: 'note-chart',
        name: 'Saved chart',
        path: '/Saved chart',
        paragraphs: [
          {
            id: 'paragraph-chart',
            text: '%sh saved',
            status: 'FINISHED',
            config: { results: { 0: { graph: { mode: 'multiBarChart', keys: [], groups: [], values: [] } } } },
            results: { msg: [{ type: DatasetType.TABLE, data: 'city\tamount\nSeoul\t2' }] }
          }
        ]
      } as unknown as NotebookCoreWireNote);
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });

    expect(onReady).not.toHaveBeenCalled();
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onReady).not.toHaveBeenCalled();
    store.dispose();
  });

  it('reports readiness after a saved chart has been constructed', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-chart', null);
    const onReady = vi.fn();
    const onError = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady, onError }).unmount;
      store.acceptNote(request, {
        id: 'note-chart',
        name: 'Saved chart',
        path: '/Saved chart',
        paragraphs: [
          {
            id: 'paragraph-chart',
            text: '%sh saved',
            status: 'FINISHED',
            config: { results: { 0: { graph: { mode: 'multiBarChart', keys: [], groups: [], values: [] } } } },
            results: { msg: [{ type: DatasetType.TABLE, data: 'city\tamount\nSeoul\t2' }] }
          }
        ]
      } as unknown as NotebookCoreWireNote);
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });

    expect(onReady).not.toHaveBeenCalled();
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(onError).not.toHaveBeenCalled();
    store.dispose();
  });

  it('applies the saved stacked bar setting to the chart and accessible table', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-chart', null);
    const onReady = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady }).unmount;
      store.acceptNote(request, {
        id: 'note-chart',
        name: 'Saved stacked chart',
        path: '/Saved stacked chart',
        paragraphs: [
          {
            id: 'paragraph-chart',
            text: '%sh saved',
            status: 'FINISHED',
            config: {
              results: {
                0: {
                  graph: {
                    mode: 'multiBarChart',
                    keys: [{ name: 'city' }],
                    groups: [],
                    values: [{ name: 'amount', aggr: 'sum' }],
                    setting: { multiBarChart: { stacked: true } }
                  }
                }
              }
            },
            results: { msg: [{ type: DatasetType.TABLE, data: 'city\tamount\nSeoul\t2\nSeoul\t4' }] }
          }
        ]
      } as unknown as NotebookCoreWireNote);
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(chartConfigurations[0]).toMatchObject({
      type: 'bar',
      data: { labels: ['Seoul'], datasets: [{ label: 'amount(sum)', data: [6] }] },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } }
    });
    expect(element.querySelector('details table')?.textContent).toContain('amount(sum)');
    store.dispose();
  });

  it('offers the default Angular route for an unsupported saved chart without reporting readiness', () => {
    window.location.hash = '#/notebook/note-chart?notebookReactPrivate=true&term=saved';
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-chart', null);
    const onReady = vi.fn();
    const onError = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady, onError }).unmount;
      store.acceptNote(request, {
        id: 'note-chart',
        name: 'Saved stream chart',
        path: '/Saved stream chart',
        paragraphs: [
          {
            id: 'paragraph-chart',
            text: '%sh saved',
            status: 'FINISHED',
            config: {
              results: {
                0: {
                  graph: {
                    mode: 'stackedAreaChart',
                    keys: [],
                    groups: [],
                    values: [],
                    setting: { stackedAreaChart: { style: 'stream' } }
                  }
                }
              }
            },
            results: { msg: [{ type: DatasetType.TABLE, data: 'city\tamount\nSeoul\t2' }] }
          }
        ]
      } as unknown as NotebookCoreWireNote);
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });

    const link = element.querySelector<HTMLAnchorElement>('a');
    expect(link?.textContent).toBe('Open the default Angular notebook');
    expect(link?.getAttribute('href')).toBe('#/notebook/note-chart?term=saved');
    expect(element.textContent).toContain('cannot display');
    expect(onError).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    store.dispose();
  });

  it('keeps Angular component results on the default route', () => {
    window.location.hash = '#/notebook/note-angular?notebookReactPrivate=true';
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-angular', null);
    const onReady = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady }).unmount;
      store.acceptNote(request, {
        id: 'note-angular',
        name: 'Angular component note',
        path: '/Angular component note',
        paragraphs: [
          {
            id: 'paragraph-angular',
            text: '%angular saved',
            status: 'FINISHED',
            results: { msg: [{ type: DatasetType.ANGULAR, data: '<p>saved</p>' }] }
          }
        ]
      } as unknown as NotebookCoreWireNote);
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });

    expect(element.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('#/notebook/note-angular');
    expect(element.textContent).toContain('cannot display');
    expect(onReady).not.toHaveBeenCalled();
    store.dispose();
  });

  it('reports readiness again for a different route after its note and ACL load', () => {
    const store = new NotebookCoreReadStore('');
    const onReady = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady }).unmount;
    });
    const first = store.beginRoute('note-1', null);
    act(() => {
      store.acceptNote(first, { id: 'note-1', name: 'First', path: '/First', paragraphs: [] });
      store.acceptPermissions(first, { owners: [], readers: [], writers: [], runners: [] });
    });
    expect(onReady).toHaveBeenCalledOnce();

    const second = store.beginRoute('note-2', null);
    act(() => {
      store.acceptNote(second, { id: 'note-2', name: 'Second', path: '/Second', paragraphs: [] });
    });
    expect(onReady).toHaveBeenCalledOnce();
    act(() => {
      store.acceptPermissions(second, { owners: [], readers: [], writers: [], runners: [] });
    });
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(element.querySelector('h1')?.textContent).toBe('Second');
    store.dispose();
  });

  it('waits for a fresh read of the same route before reporting ready again', () => {
    const store = new NotebookCoreReadStore('');
    const onReady = vi.fn();
    act(() => {
      unmount = mount(element, { core: store.port, onReady }).unmount;
    });
    let request = store.beginRoute('note-1', null);
    act(() => {
      store.acceptNote(request, { id: 'note-1', name: 'First load', path: '/First', paragraphs: [] });
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });
    expect(onReady).toHaveBeenCalledOnce();

    act(() => {
      request = store.beginRoute('note-1', null);
    });
    expect(element.textContent).toContain('Loading notebook');
    expect(onReady).toHaveBeenCalledOnce();
    act(() => {
      store.acceptNote(request, { id: 'note-1', name: 'Reloaded', path: '/Reloaded', paragraphs: [] });
    });
    expect(onReady).toHaveBeenCalledOnce();
    act(() => {
      store.acceptPermissions(request, { owners: [], readers: [], writers: [], runners: [] });
    });
    expect(onReady).toHaveBeenCalledTimes(2);
    store.dispose();
  });
});
