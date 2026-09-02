// @vitest-environment node

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

import { describe, expect, it, vi } from 'vitest';

import { createNotebookCore, selectNotebookParagraphViews } from './notebook-core';

describe('notebook core runtime spike', () => {
  it('delegates commands to the host without giving the remote direct transport access', () => {
    const dispatched: unknown[] = [];
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      dispatchCommand: command => {
        dispatched.push(command);
        return command.paragraphId === 'p-1';
      }
    });
    const snapshot = runtime.port.getSnapshot();

    expect(runtime.port.dispatch({ type: 'run-paragraph', paragraphId: 'p-1' })).toBe(true);
    expect(runtime.port.dispatch({ type: 'run-paragraph', paragraphId: 'missing' })).toBe(false);
    expect(dispatched).toEqual([
      { type: 'run-paragraph', paragraphId: 'p-1' },
      { type: 'run-paragraph', paragraphId: 'missing' }
    ]);
    expect(runtime.port.getSnapshot()).toBe(snapshot);
  });

  it('keeps one cached immutable snapshot until the host applies a new event', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    const initialSnapshot = runtime.port.getSnapshot();

    expect(runtime.port.getSnapshot()).toBe(initialSnapshot);
    expect(initialSnapshot).toEqual({
      version: 0,
      noteId: 'note-a',
      revisionId: null,
      phase: 'idle',
      title: null,
      paragraphs: [],
      error: null
    });
    expect(Object.isFrozen(initialSnapshot)).toBe(true);
    expect(Object.isFrozen(initialSnapshot.paragraphs)).toBe(true);

    expect(runtime.apply({ type: 'load-started' })).toBe(true);

    expect(runtime.port.getSnapshot()).not.toBe(initialSnapshot);
    expect(runtime.port.getSnapshot()).toMatchObject({ version: 1, phase: 'loading' });
  });

  it('reports whether an event was accepted without publishing ignored events', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    const listener = vi.fn();
    runtime.port.subscribe(listener);

    expect(
      runtime.apply({
        type: 'note-loaded',
        noteId: 'stale-note',
        revisionId: null,
        title: 'Stale note',
        paragraphs: []
      })
    ).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    expect(runtime.apply({ type: 'load-started' })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('publishes read-only notebook fixtures through the stable port and honors unsubscribe', () => {
    const runtime = createNotebookCore();
    const listener = vi.fn();
    const unsubscribe = runtime.port.subscribe(listener);
    const port = runtime.port;

    runtime.apply({ type: 'route-changed', noteId: 'note-route', revisionId: 'rev-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-route',
      revisionId: 'rev-1',
      title: 'Runtime proof note',
      paragraphs: [
        { id: 'p-1', text: '%md shared state', status: 'FINISHED' },
        { id: 'p-2', text: '%spark 1 + 1', status: 'READY' }
      ]
    });

    const readySnapshot = runtime.port.getSnapshot();
    expect(runtime.port).toBe(port);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(readySnapshot).toEqual({
      version: 3,
      noteId: 'note-route',
      revisionId: 'rev-1',
      phase: 'ready',
      title: 'Runtime proof note',
      paragraphs: [
        { id: 'p-1', text: '%md shared state', status: 'FINISHED' },
        { id: 'p-2', text: '%spark 1 + 1', status: 'READY' }
      ],
      error: null
    });
    expect(Object.isFrozen(readySnapshot.paragraphs[0])).toBe(true);

    unsubscribe();
    runtime.apply({
      type: 'load-failed',
      noteId: 'note-route',
      revisionId: 'rev-1',
      error: 'fixture unavailable'
    });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(runtime.port.getSnapshot()).toMatchObject({
      version: 4,
      phase: 'error',
      error: 'fixture unavailable'
    });
  });

  it('notifies a remounted listener once after the previous listener unsubscribes', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const unsubscribe = runtime.port.subscribe(firstListener);
    runtime.apply({ type: 'load-started' });
    unsubscribe();
    runtime.port.subscribe(secondListener);

    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Remounted note',
      paragraphs: []
    });

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale note response after the route changes', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    const listener = vi.fn();
    runtime.port.subscribe(listener);

    runtime.apply({ type: 'load-started' });
    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: 'rev-b' });
    runtime.apply({ type: 'load-started' });
    const loadingNoteB = runtime.port.getSnapshot();

    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Stale note A',
      paragraphs: [{ id: 'p-stale', text: '%md stale', status: 'FINISHED' }]
    });
    runtime.apply({
      type: 'load-failed',
      noteId: 'note-b',
      revisionId: null,
      error: 'Stale non-revision failure'
    });

    expect(runtime.port.getSnapshot()).toBe(loadingNoteB);
    expect(runtime.port.getSnapshot()).toMatchObject({
      version: 3,
      noteId: 'note-b',
      revisionId: 'rev-b',
      phase: 'loading'
    });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('applies incremental notebook mutations idempotently after the matching note is ready', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Original title',
      paragraphs: [
        { id: 'p-1', text: '%md one', status: 'FINISHED' },
        { id: 'p-2', text: '%md two', status: 'READY' }
      ]
    });

    runtime.apply({
      type: 'paragraph-added',
      index: 1,
      paragraph: { id: 'p-3', text: '%md three', status: 'PENDING' }
    });
    const afterAdd = runtime.port.getSnapshot();
    expect(afterAdd.paragraphs.map(paragraph => paragraph.id)).toEqual(['p-1', 'p-3', 'p-2']);

    runtime.apply({
      type: 'paragraph-added',
      index: 1,
      paragraph: { id: 'p-3', text: '%md duplicate', status: 'ERROR' }
    });
    expect(runtime.port.getSnapshot()).toBe(afterAdd);

    runtime.apply({ type: 'paragraph-moved', paragraphId: 'p-3', index: 2 });
    expect(runtime.port.getSnapshot().paragraphs.map(paragraph => paragraph.id)).toEqual(['p-1', 'p-2', 'p-3']);

    runtime.apply({ type: 'paragraph-removed', paragraphId: 'p-2' });
    runtime.apply({ type: 'note-updated', title: 'Updated title' });
    expect(runtime.port.getSnapshot()).toMatchObject({ title: 'Updated title' });
    expect(runtime.port.getSnapshot().paragraphs.map(paragraph => paragraph.id)).toEqual(['p-1', 'p-3']);

    const settled = runtime.port.getSnapshot();
    runtime.apply({ type: 'paragraph-removed', paragraphId: 'missing' });
    runtime.apply({ type: 'paragraph-moved', paragraphId: 'missing', index: 0 });
    runtime.apply({ type: 'note-updated', title: 'Updated title' });
    expect(runtime.port.getSnapshot()).toBe(settled);
  });

  it('projects paragraph text and execution status updates idempotently', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '', status: 'READY' }]
    });

    expect(
      runtime.apply({
        type: 'paragraph-updated',
        paragraphId: 'p-1',
        text: '%python\nprint("updated")'
      })
    ).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0]).toEqual({
      id: 'p-1',
      text: '%python\nprint("updated")',
      status: 'READY'
    });

    expect(runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', status: 'RUNNING' })).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0]).toEqual({
      id: 'p-1',
      text: '%python\nprint("updated")',
      status: 'RUNNING'
    });

    const settled = runtime.port.getSnapshot();
    expect(
      runtime.apply({
        type: 'paragraph-updated',
        paragraphId: 'p-1',
        text: '%python\nprint("updated")',
        status: 'RUNNING'
      })
    ).toBe(false);
    expect(runtime.apply({ type: 'paragraph-updated', paragraphId: 'missing', status: 'ERROR' })).toBe(false);
    expect(runtime.port.getSnapshot()).toBe(settled);
  });

  it('projects Angular paragraph views from Core membership and order only', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    const paragraphViews = new Map([
      ['p-1', { id: 'p-1', localEditor: 'editor-one' }],
      ['p-2', { id: 'p-2', localEditor: 'editor-two' }],
      ['p-3', { id: 'p-3', localEditor: 'editor-three' }],
      ['p-angular-only', { id: 'p-angular-only', localEditor: 'must-not-render' }]
    ]);
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [
        { id: 'p-1', text: '%md one', status: 'FINISHED' },
        { id: 'p-2', text: '%md two', status: 'READY' }
      ]
    });

    runtime.apply({
      type: 'paragraph-added',
      index: 1,
      paragraph: { id: 'p-3', text: '%md three', status: 'PENDING' }
    });
    expect(
      selectNotebookParagraphViews(runtime.port.getSnapshot(), paragraphViews).map(paragraph => paragraph.id)
    ).toEqual(['p-1', 'p-3', 'p-2']);

    runtime.apply({ type: 'paragraph-removed', paragraphId: 'p-2' });
    expect(
      selectNotebookParagraphViews(runtime.port.getSnapshot(), paragraphViews).map(paragraph => paragraph.id)
    ).toEqual(['p-1', 'p-3']);

    paragraphViews.delete('p-3');
    expect(() => selectNotebookParagraphViews(runtime.port.getSnapshot(), paragraphViews)).toThrow(
      'Missing paragraph view for Core paragraph p-3'
    );
  });

  it('projects large notebook paragraph views without changing Core order', () => {
    const runtime = createNotebookCore({ noteId: 'large-note', revisionId: null });
    const paragraphs = Array.from({ length: 10000 }, (_, index) => ({
      id: `p-${index}`,
      text: `%md paragraph ${index}`,
      status: 'READY' as const
    }));
    const paragraphViews = new Map(paragraphs.map(paragraph => [paragraph.id, { id: paragraph.id }]));

    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'large-note',
      revisionId: null,
      title: 'Large note',
      paragraphs
    });

    const selected = selectNotebookParagraphViews(runtime.port.getSnapshot(), paragraphViews);

    expect(selected).toHaveLength(10000);
    expect(selected[0]).toBe(paragraphViews.get('p-0'));
    expect(selected[9999]).toBe(paragraphViews.get('p-9999'));
  });

  it('ignores uncorrelated incremental mutations while a new route is loading', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-a', text: '%md A', status: 'READY' }]
    });
    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    runtime.apply({ type: 'load-started' });
    const loadingNoteB = runtime.port.getSnapshot();

    runtime.apply({
      type: 'paragraph-added',
      index: 0,
      paragraph: { id: 'p-stale', text: '%md stale A', status: 'FINISHED' }
    });
    runtime.apply({ type: 'paragraph-removed', paragraphId: 'p-a' });
    runtime.apply({ type: 'paragraph-moved', paragraphId: 'p-a', index: 0 });
    runtime.apply({ type: 'note-updated', title: 'Stale title A' });

    expect(runtime.port.getSnapshot()).toBe(loadingNoteB);
    expect(runtime.port.getSnapshot()).toMatchObject({
      noteId: 'note-b',
      phase: 'loading',
      title: null,
      paragraphs: []
    });
  });
});
