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

const defaultParagraphPresentation = {
  forms: {},
  params: {},
  config: {
    editorHide: false,
    tableHide: false,
    title: false,
    enabled: true,
    lineNumbers: false,
    fontSize: 9,
    colWidth: 12,
    runOnSelectionChange: false,
    editOnDblClick: false,
    completionSupport: false
  }
};

const createTaskScheduler = () => {
  let now = 0;
  let nextId = 0;
  const tasks = new Map<number, { dueAt: number; task: () => void }>();
  return {
    scheduleTask: (task: () => void, delayMs: number) => {
      const id = ++nextId;
      tasks.set(id, { dueAt: now + delayMs, task });
      return id;
    },
    cancelTask: (id: unknown) => tasks.delete(id as number),
    advanceBy: (delayMs: number) => {
      now += delayMs;
      for (const [id, scheduled] of [...tasks]) {
        if (scheduled.dueAt <= now) {
          tasks.delete(id);
          scheduled.task();
        }
      }
    }
  };
};

describe('notebook core runtime spike', () => {
  it('delegates commands to the host without giving the remote direct transport access', () => {
    const dispatched: unknown[] = [];
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      dispatchCommand: command => {
        dispatched.push(command);
        return 'paragraphId' in command && command.paragraphId === 'p-1';
      }
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Command note',
      paragraphs: [{ id: 'p-1', text: '%md command', status: 'READY' }]
    });
    const snapshot = runtime.port.getSnapshot();

    expect(runtime.port.dispatch({ type: 'run-paragraph', paragraphId: 'p-1' })).toBe(true);
    expect(runtime.port.dispatch({ type: 'run-paragraph', paragraphId: 'missing' })).toBe(false);
    expect(dispatched).toEqual([{ type: 'run-paragraph', paragraphId: 'p-1' }]);
    expect(runtime.port.getSnapshot()).not.toBe(snapshot);
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ status: 'PENDING' });
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
      noteForms: {},
      noteParams: {},
      lookAndFeel: 'default',
      personalizedMode: false,
      paragraphs: [],
      error: null
    });
    expect(Object.isFrozen(initialSnapshot)).toBe(true);
    expect(Object.isFrozen(initialSnapshot.paragraphs)).toBe(true);

    expect(runtime.apply({ type: 'load-started' })).toBe(true);

    expect(runtime.port.getSnapshot()).not.toBe(initialSnapshot);
    expect(runtime.port.getSnapshot()).toMatchObject({ version: 1, phase: 'loading' });
  });

  it('owns streamed output updates and appends without exposing the transport', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Output note',
      paragraphs: [{ id: 'p-1', text: '%python', status: 'RUNNING' }]
    });

    expect(
      runtime.apply({
        type: 'paragraph-output-updated',
        paragraphId: 'p-1',
        index: 0,
        result: { type: 'TEXT', data: 'first' }
      })
    ).toBe(true);
    expect(runtime.apply({ type: 'paragraph-output-appended', paragraphId: 'p-1', index: 0, data: ' second' })).toBe(
      true
    );
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', status: 'FINISHED' });

    expect(runtime.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'first second' }]);
    expect(runtime.apply({ type: 'paragraph-output-appended', paragraphId: 'p-1', index: 0, data: ' too late' })).toBe(
      false
    );
  });

  it('applies authoritative terminal results and cleared results from a paragraph update', () => {
    const runtime = createNotebookCore({ noteId: 'note-a' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Terminal output',
      paragraphs: [{ id: 'p-1', text: '%python', status: 'RUNNING', results: [{ type: 'TEXT', data: 'old' }] }]
    });

    expect(
      runtime.apply({
        type: 'paragraph-updated',
        paragraphId: 'p-1',
        status: 'FINISHED',
        results: [{ type: 'TEXT', data: 'complete' }],
        source: 'server'
      })
    ).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'complete' }]);
    expect(
      runtime.apply({
        type: 'paragraph-updated',
        paragraphId: 'p-1',
        results: undefined,
        source: 'server'
      })
    ).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0].results).toBeUndefined();
  });

  it('ignores duplicate output frames and accepts an authoritative output snapshot after a gap', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Sequenced output',
      paragraphs: [{ id: 'p-1', text: '%python', status: 'RUNNING' }]
    });

    expect(
      runtime.apply({
        type: 'paragraph-output-updated',
        paragraphId: 'p-1',
        index: 0,
        result: { type: 'TEXT', data: 'first' },
        outputSequence: 1
      })
    ).toBe(true);
    expect(
      runtime.apply({
        type: 'paragraph-output-appended',
        paragraphId: 'p-1',
        index: 0,
        data: ' duplicate',
        outputSequence: 1
      })
    ).toBe(false);
    expect(
      runtime.apply({
        type: 'paragraph-output-snapshotted',
        paragraphId: 'p-1',
        results: [{ type: 'TEXT', data: 'first recovered' }],
        outputSequence: 3
      })
    ).toBe(true);
    expect(
      runtime.apply({
        type: 'paragraph-output-appended',
        paragraphId: 'p-1',
        index: 0,
        data: ' stale',
        outputSequence: 2
      })
    ).toBe(false);
    expect(runtime.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'first recovered' }]);
    expect(
      runtime.apply({
        type: 'paragraph-output-snapshotted',
        paragraphId: 'p-1',
        results: [{ type: 'TEXT', data: 'stale snapshot' }],
        outputSequence: 2
      })
    ).toBe(false);
    expect(runtime.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'first recovered' }]);
  });

  it('preserves server result configuration without sharing mutable graph state', () => {
    const runtime = createNotebookCore({ noteId: 'note-a' });
    const graph = { mode: 'lineChart', setting: { lineChart: { smooth: true } } };
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Configured output',
      paragraphs: [{ id: 'p-1', text: '%python', status: 'FINISHED', resultConfigs: { '0': { graph } } }]
    });

    graph.mode = 'table';
    expect(runtime.port.getSnapshot().paragraphs[0].resultConfigs).toEqual({
      '0': { graph: { mode: 'lineChart', setting: { lineChart: { smooth: true } } } }
    });
    expect(Object.isFrozen(runtime.port.getSnapshot().paragraphs[0].resultConfigs)).toBe(true);
  });

  it('owns bounded progress updates for a known paragraph', () => {
    const runtime = createNotebookCore({ noteId: 'note-a' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Progress notebook',
      paragraphs: [{ id: 'p-1', text: '%python', status: 'RUNNING', progress: 0 }]
    });

    expect(runtime.apply({ type: 'paragraph-progressed', paragraphId: 'p-1', progress: 42 })).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0].progress).toBe(42);
    expect(runtime.apply({ type: 'paragraph-progressed', paragraphId: 'p-1', progress: 110 })).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0].progress).toBe(100);
    expect(runtime.apply({ type: 'paragraph-progressed', paragraphId: 'missing', progress: 20 })).toBe(false);
  });

  it('owns immutable note form definitions and values through the stable port', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Form note',
      noteForms: {
        region: {
          name: 'region',
          displayName: 'Region',
          type: 'Select',
          defaultValue: 'us-east-1',
          hidden: false,
          options: [{ value: 'us-east-1' }, { value: 'ap-northeast-2', displayName: 'Seoul' }]
        }
      },
      noteParams: { region: 'us-east-1' },
      paragraphs: []
    });

    expect(runtime.port.getSnapshot().noteParams).toEqual({ region: 'us-east-1' });
    expect(Object.isFrozen(runtime.port.getSnapshot().noteForms.region.options)).toBe(true);
    expect(
      runtime.apply({
        type: 'note-forms-updated',
        noteForms: runtime.port.getSnapshot().noteForms,
        noteParams: { region: 'ap-northeast-2' }
      })
    ).toBe(true);
    expect(runtime.port.getSnapshot().noteParams).toEqual({ region: 'ap-northeast-2' });
    expect(Object.isFrozen(runtime.port.getSnapshot().noteParams)).toBe(true);
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
      noteForms: {},
      noteParams: {},
      lookAndFeel: 'default',
      personalizedMode: false,
      paragraphs: [
        {
          ...defaultParagraphPresentation,
          id: 'p-1',
          text: '%md shared state',
          status: 'FINISHED',
          progress: 0,
          isDirty: false,
          isSaving: false,
          hasConflict: false
        },
        {
          ...defaultParagraphPresentation,
          id: 'p-2',
          text: '%spark 1 + 1',
          status: 'READY',
          progress: 0,
          isDirty: false,
          isSaving: false,
          hasConflict: false
        }
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
      ...defaultParagraphPresentation,
      id: 'p-1',
      text: '%python\nprint("updated")',
      status: 'READY',
      progress: 0,
      isDirty: true,
      isSaving: false,
      hasConflict: false
    });

    expect(runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', status: 'RUNNING' })).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0]).toEqual({
      ...defaultParagraphPresentation,
      id: 'p-1',
      text: '%python\nprint("updated")',
      status: 'RUNNING',
      progress: 0,
      isDirty: true,
      isSaving: false,
      hasConflict: false
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

  it('keeps a local draft when a delayed server confirmation contains older text', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md local draft', source: 'local' });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md saved', source: 'server' });

    expect(runtime.port.getSnapshot().paragraphs[0]).toEqual({
      ...defaultParagraphPresentation,
      id: 'p-1',
      text: '%md local draft',
      status: 'READY',
      progress: 0,
      isDirty: true,
      isSaving: false,
      hasConflict: false
    });

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md local draft', source: 'server' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md local draft', isDirty: false });
  });

  it('owns paragraph edits through the framework-neutral command port', () => {
    const dispatchCommand = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    expect(runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md draft' })).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md draft', isDirty: true });
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md draft' })).toBe(false);
  });

  it('keeps a local draft across reload and reconciles it against the new server base', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md local draft', source: 'local' });

    runtime.apply({ type: 'load-started' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md local draft', isDirty: true });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A reloaded',
      paragraphs: [{ id: 'p-1', text: '%md server changed', status: 'READY' }]
    });

    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md local draft',
      isDirty: true
    });
  });

  it('keeps a local draft when reloading the current route fails', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md local draft', source: 'local' });

    runtime.apply({ type: 'load-started' });
    runtime.apply({ type: 'load-failed', noteId: 'note-a', revisionId: null, error: 'offline' });

    expect(runtime.port.getSnapshot()).toMatchObject({ phase: 'error', error: 'offline' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md local draft', isDirty: true });
  });

  it('allows one commit for a dirty draft until the server confirms it', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md draft', source: 'local' });

    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(true);
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(false);
    expect(dispatchCommand).toHaveBeenCalledTimes(1);

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md draft', source: 'server' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md draft', isDirty: false });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(false);
  });

  it('keeps a newer draft when an older save is confirmed', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v1' });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(true);
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v2' });

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md v1', source: 'server' });

    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md v2', isDirty: true });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledTimes(2);
  });

  it('keeps a dirty draft and permits retry when the host rejects a commit', () => {
    const dispatchCommand = vi.fn(() => false);
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md draft' });

    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(false);
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md draft', isDirty: true });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(false);
    expect(dispatchCommand).toHaveBeenCalledTimes(2);
  });

  it('debounces paragraph saves in Core and commits the latest draft', () => {
    const scheduler = createTaskScheduler();
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      autoSaveDelayMs: 10000,
      ...scheduler,
      dispatchCommand
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v1' });
    scheduler.advanceBy(9000);
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v2' });
    scheduler.advanceBy(9999);
    expect(dispatchCommand).not.toHaveBeenCalled();

    scheduler.advanceBy(1);
    expect(dispatchCommand).toHaveBeenCalledOnce();
    expect(dispatchCommand).toHaveBeenCalledWith({ type: 'commit-paragraph', paragraphId: 'p-1' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ text: '%md v2', isDirty: true });
  });

  it('cancels scheduled saves when a route changes or collaboration sends a patch', () => {
    const scheduler = createTaskScheduler();
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      autoSaveDelayMs: 10000,
      ...scheduler,
      dispatchCommand
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md patched' });
    runtime.port.dispatch({ type: 'patch-paragraph', paragraphId: 'p-1', patch: 'patch' });
    scheduler.advanceBy(10000);
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenLastCalledWith({
      type: 'patch-paragraph',
      paragraphId: 'p-1',
      patch: 'patch'
    });

    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md route draft' });
    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    scheduler.advanceBy(10000);
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
  });

  it('reschedules a newer draft after the pending save is confirmed', () => {
    const scheduler = createTaskScheduler();
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      autoSaveDelayMs: 10000,
      ...scheduler,
      dispatchCommand
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v1' });
    scheduler.advanceBy(10000);
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v2' });
    scheduler.advanceBy(10000);
    expect(dispatchCommand).toHaveBeenCalledTimes(1);

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md v1', source: 'server' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md v2',
      isDirty: true,
      isSaving: false,
      hasConflict: false
    });
    scheduler.advanceBy(10000);
    expect(dispatchCommand).toHaveBeenCalledTimes(2);
  });

  it('reschedules a dirty draft after reconnect completes', () => {
    const scheduler = createTaskScheduler();
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      autoSaveDelayMs: 10000,
      ...scheduler,
      dispatchCommand
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md offline draft' });

    runtime.apply({ type: 'load-started' });
    scheduler.advanceBy(10000);
    expect(dispatchCommand).not.toHaveBeenCalled();
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });
    scheduler.advanceBy(10000);

    expect(dispatchCommand).toHaveBeenCalledOnce();
    expect(runtime.port.getSnapshot().paragraphs[0].text).toBe('%md offline draft');
  });

  it('restores an unsaved draft after navigating away and back', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md draft' });

    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-b',
      revisionId: null,
      title: 'Note B',
      paragraphs: [{ id: 'p-b', text: '%md B', status: 'READY' }]
    });
    runtime.apply({ type: 'route-changed', noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md draft',
      isDirty: true,
      hasConflict: false
    });
  });

  it('blocks autosave when reload detects a conflicting server edit', () => {
    const scheduler = createTaskScheduler();
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      autoSaveDelayMs: 10000,
      ...scheduler,
      dispatchCommand
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md local' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md peer', status: 'READY' }]
    });

    scheduler.advanceBy(10000);
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md local',
      isDirty: true,
      isSaving: false,
      hasConflict: true
    });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();

    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md peer', status: 'READY' }]
    });
    scheduler.advanceBy(10000);
    expect(runtime.port.getSnapshot().paragraphs[0].hasConflict).toBe(true);
    expect(dispatchCommand).not.toHaveBeenCalled();

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md peer', source: 'server' });
    scheduler.advanceBy(10000);
    expect(runtime.port.getSnapshot().paragraphs[0].hasConflict).toBe(true);
    expect(runtime.port.dispatch({ type: 'run-paragraph', paragraphId: 'p-1' })).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it('blocks Run All until every paragraph conflict is resolved', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md local' });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md peer', source: 'server' });

    expect(runtime.port.dispatch({ type: 'run-all-paragraphs' })).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();

    expect(
      runtime.port.dispatch({
        type: 'resolve-paragraph-conflict',
        paragraphId: 'p-1',
        resolution: 'accept-server'
      })
    ).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md peer',
      isDirty: false,
      hasConflict: false
    });
    expect(runtime.port.dispatch({ type: 'run-all-paragraphs' })).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledOnce();
  });

  it('keeps a local conflict resolution dirty so it can be saved', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md local' });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md peer', source: 'server' });

    expect(
      runtime.port.dispatch({
        type: 'resolve-paragraph-conflict',
        paragraphId: 'p-1',
        resolution: 'keep-local'
      })
    ).toBe(true);
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md local',
      isDirty: true,
      hasConflict: false
    });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(true);
  });

  it('sends collaborative edits and local conflict resolutions as patches from Core', () => {
    const dispatchCommand = vi.fn(() => true);
    const createParagraphPatch = vi.fn((previousText: string, nextText: string) => `${previousText}->${nextText}`);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      dispatchCommand,
      createParagraphPatch
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });
    runtime.apply({ type: 'collaboration-updated', users: [] });

    expect(runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md local' })).toBe(true);
    expect(dispatchCommand).toHaveBeenLastCalledWith({
      type: 'patch-paragraph',
      paragraphId: 'p-1',
      patch: '%md base->%md local'
    });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md local',
      isDirty: true,
      hasConflict: false
    });

    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md local',
      isDirty: true,
      hasConflict: false
    });

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md peer', source: 'collaboration' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md peer',
      isDirty: true,
      hasConflict: false
    });

    runtime.apply({ type: 'collaboration-updated', users: null });
    expect(runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md local v2' })).toBe(true);
    runtime.apply({ type: 'collaboration-updated', users: [] });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md peer v2', source: 'server' });
    dispatchCommand.mockClear();

    expect(runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md bypass' })).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(
      runtime.port.dispatch({
        type: 'resolve-paragraph-conflict',
        paragraphId: 'p-1',
        resolution: 'keep-local'
      })
    ).toBe(true);
    expect(dispatchCommand).toHaveBeenLastCalledWith({
      type: 'patch-paragraph',
      paragraphId: 'p-1',
      patch: '%md peer v2->%md local v2'
    });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md local v2',
      isDirty: true,
      hasConflict: false
    });
  });

  it('keeps a pending save through peer patches until its server acknowledgement', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      dispatchCommand,
      createParagraphPatch: (previousText, nextText) => `${previousText}->${nextText}`
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: 'A', status: 'READY' }]
    });
    runtime.apply({ type: 'collaboration-updated', users: [] });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: 'B' });
    runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' });

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: 'BC', source: 'collaboration' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'BC',
      isDirty: true,
      isSaving: true,
      hasConflict: false
    });

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: 'B', source: 'server' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'BC',
      isDirty: true,
      isSaving: false,
      hasConflict: false
    });
  });

  it('preserves an edit back to the saved text while another save is pending', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: 'A', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: 'B' });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(true);
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: 'A' });

    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: 'B', source: 'server' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'A',
      isDirty: true,
      isSaving: false,
      hasConflict: false
    });

    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(true);
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: 'A', source: 'server' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'A',
      isDirty: false,
      isSaving: false,
      hasConflict: false
    });
  });

  it('retains a pending-save undo across reload and route restoration', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand: () => true });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: 'A', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: 'B' });
    runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: 'A' });

    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: 'B', status: 'READY' }]
    });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'A',
      isDirty: true,
      hasConflict: false
    });

    runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: 'B' });
    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    runtime.apply({ type: 'route-changed', noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: 'A', status: 'READY' }]
    });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'B',
      isDirty: true,
      hasConflict: false
    });
    expect(runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' })).toBe(true);
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: 'B', source: 'server' });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'B',
      isDirty: false,
      isSaving: false,
      hasConflict: false
    });
  });

  it('preserves collaboration status received before the note snapshot', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      dispatchCommand,
      createParagraphPatch: (previousText, nextText) => `${previousText}->${nextText}`
    });

    runtime.apply({ type: 'load-started' });
    runtime.apply({ type: 'collaboration-updated', users: ['user1', 'user2'] });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });

    expect(runtime.port.getSnapshot().collaborativeUsers).toEqual(['user1', 'user2']);
    expect(runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md peer' })).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith({
      type: 'patch-paragraph',
      paragraphId: 'p-1',
      patch: '%md base->%md peer'
    });

    runtime.apply({ type: 'load-failed', noteId: 'note-a', revisionId: null, error: 'offline' });
    expect(runtime.apply({ type: 'collaboration-updated', users: ['stale-user'] })).toBe(false);
    expect(runtime.port.getSnapshot().collaborativeUsers).toEqual(['user1', 'user2']);
  });

  it('retains an unconfirmed local patch when a peer patch precedes reconnect', () => {
    const runtime = createNotebookCore({
      noteId: 'note-a',
      revisionId: null,
      dispatchCommand: () => true,
      createParagraphPatch: (previousText, nextText) => `${previousText}->${nextText}`
    });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: 'first\nmiddle\nlast', status: 'READY' }]
    });
    runtime.apply({ type: 'collaboration-updated', users: [] });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: 'LOCAL\nmiddle\nlast' });
    runtime.apply({
      type: 'paragraph-updated',
      paragraphId: 'p-1',
      text: 'LOCAL\nmiddle\nPEER',
      source: 'collaboration'
    });

    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'LOCAL\nmiddle\nPEER',
      isDirty: true,
      hasConflict: false
    });

    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: 'first\nmiddle\nPEER', status: 'READY' }]
    });
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: 'LOCAL\nmiddle\nPEER',
      isDirty: true,
      hasConflict: true
    });
  });

  it('does not revive a consumed route draft after newer saves complete', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null, dispatchCommand: () => true });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v1' });
    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-b',
      revisionId: null,
      title: 'Note B',
      paragraphs: []
    });
    runtime.apply({ type: 'route-changed', noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md base', status: 'READY' }]
    });
    runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md v1', source: 'server' });
    runtime.port.dispatch({ type: 'edit-paragraph', paragraphId: 'p-1', text: '%md v2' });
    runtime.port.dispatch({ type: 'commit-paragraph', paragraphId: 'p-1' });
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md v2', source: 'server' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md v2', status: 'READY' }]
    });

    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%md v2',
      isDirty: false,
      hasConflict: false
    });
    expect(runtime.apply({ type: 'paragraph-save-cancelled', paragraphId: 'missing' })).toBe(false);
  });

  it('restores the prior status when the host rejects a Core run request', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', dispatchCommand: () => false });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [{ id: 'p-1', text: '%md saved', status: 'READY' }]
    });

    expect(runtime.port.dispatch({ type: 'run-paragraph', paragraphId: 'p-1' })).toBe(false);
    expect(runtime.port.getSnapshot().paragraphs[0]).toMatchObject({ status: 'READY' });
  });

  it('does not apply live mutations to a loaded revision snapshot', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: 'revision-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: 'revision-1',
      title: 'Historical title',
      paragraphs: [{ id: 'p-1', text: '%md historical', status: 'FINISHED' }]
    });
    const revisionSnapshot = runtime.port.getSnapshot();

    expect(runtime.apply({ type: 'note-updated', title: 'Live title' })).toBe(false);
    expect(
      runtime.apply({
        type: 'paragraph-added',
        index: 1,
        paragraph: { id: 'p-live', text: '%md live', status: 'PENDING' }
      })
    ).toBe(false);
    expect(runtime.apply({ type: 'paragraph-removed', paragraphId: 'p-1' })).toBe(false);
    expect(runtime.apply({ type: 'paragraph-moved', paragraphId: 'p-1', index: 1 })).toBe(false);
    expect(runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-1', text: '%md changed' })).toBe(false);
    expect(
      runtime.apply({
        type: 'paragraph-output-snapshotted',
        paragraphId: 'p-1',
        results: [{ type: 'TEXT', data: 'live output' }],
        outputSequence: 1
      })
    ).toBe(false);
    expect(runtime.port.getSnapshot()).toBe(revisionSnapshot);
    expect(runtime.port.getSnapshot().title).toBe('Historical title');
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

  it('preserves unchanged paragraph identities when one paragraph changes', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: [
        { id: 'p-1', text: '%md unchanged', status: 'READY' },
        { id: 'p-2', text: '%md updated', status: 'READY' }
      ]
    });

    const before = runtime.port.getSnapshot();
    runtime.apply({ type: 'paragraph-updated', paragraphId: 'p-2', status: 'RUNNING' });
    const after = runtime.port.getSnapshot();

    expect(after.paragraphs[0]).toBe(before.paragraphs[0]);
    expect(after.paragraphs[1]).not.toBe(before.paragraphs[1]);
    expect(after.paragraphs[1]).toMatchObject({ id: 'p-2', status: 'RUNNING' });
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

  it('owns collaboration presence in the snapshot and clears it when the route changes', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      paragraphs: []
    });

    runtime.apply({ type: 'collaboration-updated', users: ['alice', 'bob'] });
    const collaborating = runtime.port.getSnapshot();
    expect(collaborating.collaborativeUsers).toEqual(['alice', 'bob']);
    expect(Object.isFrozen(collaborating.collaborativeUsers)).toBe(true);

    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    expect(runtime.port.getSnapshot().collaborativeUsers).toBeUndefined();
    expect(runtime.apply({ type: 'collaboration-updated', users: ['stale-user'] })).toBe(false);
  });

  it('owns frozen note permissions and clears them when the route changes', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({ type: 'note-loaded', noteId: 'note-a', revisionId: null, title: 'Note A', paragraphs: [] });

    runtime.apply({
      type: 'permissions-updated',
      permissions: { readers: ['reader'], owners: ['owner'], writers: ['writer'], runners: ['runner'] }
    });
    const permissions = runtime.port.getSnapshot().permissions;
    expect(permissions).toEqual({ readers: ['reader'], owners: ['owner'], writers: ['writer'], runners: ['runner'] });
    expect(Object.isFrozen(permissions)).toBe(true);
    expect(Object.isFrozen(permissions!.owners)).toBe(true);

    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    expect(runtime.port.getSnapshot().permissions).toBeUndefined();
  });

  it('owns a frozen schedule and clears it when the route changes', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      scheduler: { cron: '0 0/5 * * * ?', releaseResource: false },
      paragraphs: []
    });

    const scheduler = runtime.port.getSnapshot().scheduler;
    expect(scheduler).toEqual({ cron: '0 0/5 * * * ?', releaseResource: false });
    expect(Object.isFrozen(scheduler)).toBe(true);

    runtime.apply({ type: 'schedule-updated', scheduler: { releaseResource: true } });
    expect(runtime.port.getSnapshot().scheduler).toEqual({ releaseResource: true });

    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    expect(runtime.port.getSnapshot().scheduler).toBeUndefined();
  });

  it('owns a frozen revision list and clears it when the route changes', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({ type: 'note-loaded', noteId: 'note-a', revisionId: null, title: 'Note A', paragraphs: [] });

    runtime.apply({
      type: 'revisions-updated',
      revisions: [
        { id: 'Head', message: 'Head' },
        { id: 'revision-1', message: 'First checkpoint', time: 1 }
      ]
    });
    const revisions = runtime.port.getSnapshot().revisions;
    expect(revisions).toEqual([
      { id: 'Head', message: 'Head' },
      { id: 'revision-1', message: 'First checkpoint', time: 1 }
    ]);
    expect(Object.isFrozen(revisions)).toBe(true);
    expect(Object.isFrozen(revisions![0])).toBe(true);

    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    expect(runtime.port.getSnapshot().revisions).toBeUndefined();
  });

  it('owns the notebook look and feel and resets it for the next route', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      lookAndFeel: 'simple',
      paragraphs: []
    });
    expect(runtime.port.getSnapshot().lookAndFeel).toBe('simple');

    runtime.apply({ type: 'look-and-feel-updated', lookAndFeel: 'report' });
    expect(runtime.port.getSnapshot().lookAndFeel).toBe('report');

    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    expect(runtime.port.getSnapshot().lookAndFeel).toBe('default');
  });

  it('owns personalized mode and resets it for the next route', () => {
    const runtime = createNotebookCore({ noteId: 'note-a', revisionId: null });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-a',
      revisionId: null,
      title: 'Note A',
      personalizedMode: true,
      paragraphs: []
    });
    expect(runtime.port.getSnapshot().personalizedMode).toBe(true);

    runtime.apply({ type: 'personalized-mode-updated', personalizedMode: false });
    expect(runtime.port.getSnapshot().personalizedMode).toBe(false);

    runtime.apply({ type: 'route-changed', noteId: 'note-b', revisionId: null });
    expect(runtime.port.getSnapshot().personalizedMode).toBe(false);
  });
});
