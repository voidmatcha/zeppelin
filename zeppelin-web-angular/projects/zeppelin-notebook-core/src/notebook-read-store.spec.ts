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

import { NotebookCoreReadStore } from './notebook-read-store';
import {
  selectNote,
  selectParagraph,
  selectParagraphOrder,
  selectPersistedVisualization,
  selectReadPermissions,
  selectSavedResults
} from './notebook-read-selectors';

const note = (id: string) => ({
  id,
  name: 'A note',
  path: '/A note',
  config: { looknfeel: 'default' },
  paragraphs: [
    {
      id: 'p1',
      text: 'first',
      status: 'FINISHED',
      results: { msg: [{ data: 'output' }] },
      config: { results: { 0: { graph: {} } } }
    },
    { id: 'p2', text: 'second', status: 'READY' }
  ]
});

const permissions = () => ({ readers: ['reader'], owners: ['owner'], writers: [], runners: [] });

describe('host-owned notebook read store', () => {
  it('keeps an unsaved draft across a same-note reconnect but not a route change', () => {
    const store = new NotebookCoreReadStore('n1');
    const first = store.beginRoute('n1', null);
    store.acceptNote(first, note('n1'));
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'local edit' });
    const draft = store.getSnapshot().draftsById?.p1;

    const reconnect = store.beginRoute('n1', null);
    expect(store.getSnapshot().draftsById?.p1).toBe(draft);
    expect(store.acceptNote(first, note('n1'))).toBe(false);
    store.acceptNote(reconnect, note('n1'));
    expect(store.getSnapshot().draftsById?.p1?.text).toBe('local edit');

    store.beginRoute('n1', 'revision-1');
    expect(store.getSnapshot().draftsById).toBeUndefined();
  });

  it('keeps edits made after a save began when its delayed acknowledgement arrives', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'sent text' });
    const result = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!result.accepted || !result.save) {
      throw new Error('Expected a prepared save');
    }
    expect(store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' })).toEqual({ accepted: false });
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'newer text' });
    expect(store.acceptSaveAcknowledgement(request, { ...result.save })).toBe(false);
    expect(store.acceptSaveAcknowledgement(request, result.save)).toBe(true);
    expect(selectParagraph(store.getSnapshot(), 'p1')?.text).toBe('sent text');
    expect(store.getSnapshot().draftsById?.p1.text).toBe('newer text');
    const acknowledged = store.getSnapshot();
    expect(store.acceptSaveAcknowledgement(request, result.save)).toBe(false);
    expect(store.getSnapshot()).toBe(acknowledged);
    const newer = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!newer.accepted || !newer.save) {
      throw new Error('Expected another prepared save');
    }
    expect(store.acceptSaveAcknowledgement(request, newer.save)).toBe(true);
    expect(store.getSnapshot().draftsById?.p1).toBeUndefined();
    expect(selectParagraph(store.getSnapshot(), 'p1')?.text).toBe('newer text');
  });

  it('preserves an edit back to original text and newer server data across old save acknowledgements', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'sent' });
    const result = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!result.accepted || !result.save) {
      throw new Error('Expected a prepared save');
    }
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'first' });
    store.acceptParagraphEvent(request, {
      noteId: 'n1',
      sequence: 1,
      type: 'update',
      paragraph: { id: 'p1', text: 'collaborator', status: 'READY' }
    });
    expect(store.acceptSaveAcknowledgement(request, result.save, { id: 'p1', text: 'sent', status: 'READY' })).toBe(
      true
    );
    expect(selectParagraph(store.getSnapshot(), 'p1')?.text).toBe('collaborator');
    expect(store.getSnapshot().draftsById?.p1.text).toBe('first');
  });

  it('normalizes structural events without replacing unaffected paragraphs or local drafts', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    const untouched = selectParagraph(store.getSnapshot(), 'p2');
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'local' });
    const inserted = { id: 'p3', text: 'third', status: 'READY' };
    expect(
      store.acceptParagraphEvent(request, { noteId: 'n1', sequence: 1, type: 'insert', paragraph: inserted, index: 1 })
    ).toBe(true);
    inserted.text = 'mutated outside';
    expect(selectParagraph(store.getSnapshot(), 'p3')?.text).toBe('third');
    expect(selectParagraphOrder(store.getSnapshot())).toEqual(['p1', 'p3', 'p2']);
    expect(
      store.acceptParagraphEvent(request, { noteId: 'n1', sequence: 2, type: 'move', paragraphId: 'p2', index: 0 })
    ).toBe(true);
    expect(selectParagraphOrder(store.getSnapshot())).toEqual(['p2', 'p1', 'p3']);
    expect(
      store.acceptParagraphEvent(request, {
        noteId: 'n1',
        sequence: 3,
        type: 'update',
        paragraph: { id: 'p1', text: 'remote', status: 'READY' }
      })
    ).toBe(true);
    expect(store.getSnapshot().draftsById?.p1.text).toBe('local');
    expect(selectParagraph(store.getSnapshot(), 'p2')).toBe(untouched);
    expect(store.acceptParagraphEvent(request, { noteId: 'n1', sequence: 4, type: 'remove', paragraphId: 'p1' })).toBe(
      true
    );
    expect(selectParagraphOrder(store.getSnapshot())).toEqual(['p2', 'p3']);
    expect(selectParagraph(store.getSnapshot(), 'p1')).toBeNull();
    expect(store.getSnapshot().draftsById?.p1).toBeUndefined();
  });

  it('applies acknowledged text while retaining newer execution status', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'saved edit' });
    const result = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!result.accepted || !result.save) {
      throw new Error('Expected a prepared save');
    }
    store.acceptParagraphEvent(request, {
      noteId: 'n1',
      sequence: 1,
      type: 'update',
      paragraph: { id: 'p1', text: 'first', status: 'RUNNING' }
    });
    expect(
      store.acceptSaveAcknowledgement(request, result.save, { id: 'p1', text: 'saved edit', status: 'READY' })
    ).toBe(true);
    expect(selectParagraph(store.getSnapshot(), 'p1')).toMatchObject({ text: 'saved edit', status: 'RUNNING' });
    expect(store.getSnapshot().draftsById?.p1).toBeUndefined();
  });

  it('uses the server save payload when no newer paragraph event arrived', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'saved edit' });
    const result = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!result.accepted || !result.save) {
      throw new Error('Expected a prepared save');
    }
    const response = { id: 'p1', text: 'saved edit', status: 'READY', title: 'server title' };
    expect(store.acceptSaveAcknowledgement(request, result.save, response)).toBe(true);
    expect(selectParagraph(store.getSnapshot(), 'p1')).toMatchObject({
      text: 'saved edit',
      status: 'READY',
      title: 'server title'
    });
  });

  it('rejects duplicate, stale, wrong-note and invalid structural events with stable no-op snapshots', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    const event = { noteId: 'n1', sequence: 2, type: 'move' as const, paragraphId: 'p1', index: 0 };
    const loaded = store.getSnapshot();
    expect(store.acceptParagraphEvent(request, event)).toBe(true);
    expect(store.acceptParagraphEvent(request, event)).toBe(false);
    expect(store.acceptParagraphEvent(request, { ...event, sequence: 1 })).toBe(false);
    expect(store.acceptParagraphEvent(request, { ...event, sequence: 3, noteId: 'n2' })).toBe(false);
    expect(store.acceptParagraphEvent(request, { ...event, sequence: 3, index: -1 })).toBe(false);
    expect(store.acceptParagraphEvent(request, { ...event, sequence: 3, index: 2 })).toBe(false);
    expect(store.acceptParagraphEvent(request, { ...event, sequence: NaN })).toBe(false);
    expect(
      store.acceptParagraphEvent(request, { noteId: 'n1', sequence: 3, type: 'remove', paragraphId: 'missing' })
    ).toBe(true);
    expect(store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'first' })).toEqual({ accepted: true });
    expect(store.dispatch({ type: 'editParagraph', paragraphId: 'toString', text: 'invalid' })).toEqual({
      accepted: false
    });
    expect(store.getSnapshot()).toBe(loaded);
    store.beginRoute('n2', null);
    const back = store.beginRoute('n1', null);
    store.acceptNote(back, note('n1'));
    expect(store.acceptParagraphEvent(request, { ...event, sequence: 4 })).toBe(false);
  });

  it('keeps revisions and disposed stores immune to edits, save acknowledgements and live events', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    const save = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!save.accepted || !save.save) {
      throw new Error('Expected a prepared save');
    }
    const revision = store.beginRoute('n1', 'r1');
    store.acceptRevision(revision, { noteId: 'n1', revisionId: 'r1', note: note('n1') });
    const loaded = store.getSnapshot();
    expect(store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'revision edit' })).toEqual({
      accepted: false
    });
    expect(store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' })).toEqual({ accepted: false });
    expect(store.acceptSaveAcknowledgement(request, save.save)).toBe(false);
    expect(store.acceptParagraphEvent(revision, { noteId: 'n1', sequence: 1, type: 'remove', paragraphId: 'p1' })).toBe(
      false
    );
    expect(store.getSnapshot()).toBe(loaded);
    store.dispose();
    const disposed = store.getSnapshot();
    expect(store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'disposed' })).toEqual({ accepted: false });
    expect(store.acceptSaveAcknowledgement(request, save.save)).toBe(false);
    expect(store.acceptParagraphEvent(request, { noteId: 'n1', sequence: 2, type: 'remove', paragraphId: 'p1' })).toBe(
      false
    );
    expect(store.getSnapshot()).toBe(disposed);
  });

  it('preserves drafts on failed sends and invalidates pending saves when a paragraph is removed', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'unsaved' });
    const first = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!first.accepted || !first.save) {
      throw new Error('Expected a prepared save');
    }
    const snapshot = store.getSnapshot();
    expect(store.rejectSave(request, first.save)).toBe(true);
    expect(store.rejectSave(request, first.save)).toBe(false);
    expect(store.getSnapshot()).toBe(snapshot);
    const retry = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!retry.accepted || !retry.save) {
      throw new Error('Expected a retry save');
    }
    store.acceptParagraphEvent(request, { noteId: 'n1', sequence: 1, type: 'remove', paragraphId: 'p1' });
    expect(store.acceptSaveAcknowledgement(request, retry.save)).toBe(false);
    expect(store.getSnapshot().draftsById?.p1).toBeUndefined();
  });

  it('discards drafts and pending saves for paragraphs removed by a full refresh', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    store.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'removed draft' });
    const result = store.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    if (!result.accepted || !result.save) {
      throw new Error('Expected a prepared save');
    }
    store.acceptNote(request, { ...note('n1'), paragraphs: [note('n1').paragraphs[1]] });
    expect(store.getSnapshot().draftsById?.p1).toBeUndefined();
    store.acceptNote(request, note('n1'));
    expect(store.acceptSaveAcknowledgement(request, result.save)).toBe(false);
    expect(selectParagraph(store.getSnapshot(), 'p1')?.text).toBe('first');
  });

  it('preserves null-prototype paragraph lookup after insertion and rejects conflicting inserts', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    const event = {
      noteId: 'n1',
      sequence: 1,
      type: 'insert' as const,
      paragraph: { id: '__proto__', text: 'safe key', status: 'READY' },
      index: 1
    };
    expect(store.acceptParagraphEvent(request, event)).toBe(true);
    expect(selectParagraph(store.getSnapshot(), '__proto__')?.text).toBe('safe key');
    expect(selectParagraph(store.getSnapshot(), 'toString')).toBeNull();
    const inserted = store.getSnapshot();
    expect(store.acceptParagraphEvent(request, { ...event, sequence: 2 })).toBe(true);
    expect(store.getSnapshot()).toBe(inserted);
    expect(store.acceptParagraphEvent(request, { ...event, sequence: 3, index: 0 })).toBe(false);
    expect(store.getSnapshot()).toBe(inserted);
  });

  it('normalizes and isolates the note, results, chart config and ACL from mutable wire payloads', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    const wireNote = note('n1');
    const wirePermissions = permissions();
    expect(store.acceptPermissions(request, wirePermissions)).toBe(true);
    expect(store.acceptNote(request, wireNote)).toBe(true);

    const state = store.getSnapshot().readState;
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') {
      throw new Error('Expected a loaded note');
    }
    const read = state.data;
    expect(read.note.name).toBe('A note');
    expect(read.note.path).toBe('/A note');
    expect(read.paragraphOrder).toEqual(['p1', 'p2']);
    expect(read.paragraphsById.p1).toMatchObject({ id: 'p1', results: { msg: [{ data: 'output' }] } });
    expect(read.paragraphsById.p1.status).toBe('FINISHED');
    expect(state.acl).toEqual({ status: 'ready', permissions: wirePermissions });
    expect(Object.isFrozen(read.paragraphsById.p1)).toBe(true);
    expect(Object.isFrozen(read.paragraphsById.p1.results)).toBe(true);
    expect(Object.isFrozen(read.paragraphsById.p1.config)).toBe(true);
    expect(state.acl.status === 'ready' && Object.isFrozen(state.acl.permissions.readers)).toBe(true);

    wireNote.paragraphs[0].text = 'changed';
    wirePermissions.readers.push('another-reader');
    expect(read.paragraphsById.p1.text).toBe('first');
    expect(state.acl.status === 'ready' && state.acl.permissions.readers).toEqual(['reader']);
  });

  it('rejects late note and ACL responses across notes and revisions', () => {
    const store = new NotebookCoreReadStore('n1');
    const first = store.beginRoute('n1', null);
    const revision = store.beginRoute('n1', 'revision-1');
    expect(store.acceptNote(first, note('n1'))).toBe(false);
    expect(store.acceptPermissions(first, permissions())).toBe(false);
    expect(store.acceptNote(revision, note('n2'))).toBe(false);
    expect(store.acceptRevision(revision, { noteId: 'n1', revisionId: 'revision-1', note: note('n1') })).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ noteId: 'n1', revisionId: 'revision-1' });

    store.beginRoute('n2', null);
    expect(store.getSnapshot()).toEqual({
      noteId: 'n2',
      revisionId: null,
      readState: { status: 'loading', acl: { status: 'loading' } }
    });
    expect(store.acceptNote(revision, note('n1'))).toBe(false);

    const backToFirst = store.beginRoute('n1', null);
    expect(store.acceptNote(first, note('n1'))).toBe(false);
    expect(store.acceptNote(backToFirst, note('n1'))).toBe(true);
    expect(store.getSnapshot().readState.status).toBe('ready');
  });

  it('distinguishes delayed, denied and failed ACL from a loaded note', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    expect(store.acceptNote(request, note('n1'))).toBe(true);
    expect(store.getSnapshot().readState.acl.status).toBe('loading');
    expect(store.acceptPermissionsFailure(request, 'accessDenied')).toBe(true);
    expect(store.getSnapshot().readState.acl.status).toBe('accessDenied');
    expect(store.acceptPermissionsFailure(request, 'failed')).toBe(true);
    expect(store.getSnapshot().readState.acl.status).toBe('failed');
    expect(store.acceptPermissions(request, permissions())).toBe(true);
    expect(store.getSnapshot().readState.acl.status).toBe('ready');
    const ready = store.getSnapshot();
    expect(store.acceptPermissions(request, permissions())).toBe(true);
    expect(store.getSnapshot()).toBe(ready);
    const next = store.beginRoute('n2', null);
    expect(store.acceptPermissionsFailure(request, 'accessDenied')).toBe(false);
    expect(store.acceptNoteFailure(request, 'failed')).toBe(false);
    expect(store.acceptNoteFailure(next, 'notFound')).toBe(true);
    expect(store.getSnapshot().readState.status).toBe('notFound');
    const notFound = store.getSnapshot();
    expect(store.acceptNoteFailure(next, 'notFound')).toBe(true);
    expect(store.getSnapshot()).toBe(notFound);
  });

  it('keeps the snapshot reference when the same full NOTE arrives again', () => {
    const store = new NotebookCoreReadStore('n1');
    const listener = vi.fn();
    store.port.subscribe(listener);
    const request = store.beginRoute('n1', null);
    expect(store.acceptNote(request, note('n1'))).toBe(true);
    const loaded = store.getSnapshot();
    expect(store.acceptNote(request, note('n1'))).toBe(true);
    expect(store.getSnapshot()).toBe(loaded);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores reordered JSON fields but publishes a changed nested result', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    expect(store.acceptNote(request, note('n1'))).toBe(true);
    const first = store.getSnapshot();
    const reordered = note('n1');
    const paragraph = reordered.paragraphs[0];
    if (!paragraph.results || !paragraph.config) {
      throw new Error('Expected paragraph output and config');
    }
    reordered.paragraphs[0] = {
      results: paragraph.results,
      config: paragraph.config,
      status: paragraph.status,
      text: paragraph.text,
      id: paragraph.id
    };
    expect(store.acceptNote(request, reordered)).toBe(true);
    expect(store.getSnapshot()).toBe(first);

    const result = reordered.paragraphs[0].results;
    if (!result) {
      throw new Error('Expected paragraph output');
    }
    result.msg[0].data = 'updated output';
    expect(store.acceptNote(request, reordered)).toBe(true);
    expect(store.getSnapshot()).not.toBe(first);
    expect(first.readState.status === 'ready' && first.readState.data.paragraphsById.p1.results).toEqual({
      msg: [{ data: 'output' }]
    });
    const before = first.readState.status === 'ready' ? first.readState.data : null;
    const after = store.getSnapshot().readState;
    expect(after.status === 'ready' && after.data.note).toBe(before?.note);
    expect(after.status === 'ready' && after.data.paragraphOrder).toBe(before?.paragraphOrder);
    expect(after.status === 'ready' && after.data.paragraphsById.p2).toBe(before?.paragraphsById.p2);
  });

  it('notifies subscribers only when a snapshot becomes visible and keeps references stable between writes', () => {
    const store = new NotebookCoreReadStore('n1');
    const listener = vi.fn();
    const unsubscribe = store.port.subscribe(listener);
    const request = store.beginRoute('n1', null);
    const pending = store.getSnapshot();
    expect(store.acceptPermissions(request, permissions())).toBe(true);
    expect(store.getSnapshot()).not.toBe(pending);
    expect(store.acceptNote(request, note('n1'))).toBe(true);
    const loaded = store.getSnapshot();
    expect(store.getSnapshot()).toBe(loaded);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.acceptPermissions(Object.freeze({ ...request }), permissions())).toBe(false);
    expect(store.getSnapshot()).toBe(loaded);
    unsubscribe();
    store.beginRoute('n2', null);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('does not notify a listener twice when it resubscribes during publication', () => {
    const store = new NotebookCoreReadStore('n1');
    const listener = vi.fn(() => {
      unsubscribe();
      unsubscribe = store.port.subscribe(listener);
    });
    let unsubscribe = store.port.subscribe(listener);
    store.beginRoute('n1', null);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('exposes only the stable read-only port to a remote', () => {
    const store = new NotebookCoreReadStore('n1');
    expect(Object.keys(store.port)).toEqual(['getSnapshot', 'subscribe']);
    expect(Object.isFrozen(store.port)).toBe(true);
    expect(store.port.getSnapshot()).toBe(store.getSnapshot());
    store.beginRoute('n1', null);
    expect(store.port.getSnapshot()).toBe(store.getSnapshot());
  });

  it('rejects duplicate paragraph IDs instead of silently corrupting the order', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', null);
    const wireNote = note('n1');
    wireNote.paragraphs[1].id = 'p1';
    expect(() => store.acceptNote(request, wireNote)).toThrow('Duplicate paragraph ID: p1');
    expect(store.getSnapshot().readState.status).toBe('loading');
  });

  it('accepts revisions only with the matching request, revision ID and note ID', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', 'r1');
    expect(store.acceptNote(request, note('n1'))).toBe(false);
    expect(store.acceptRevision(request, { noteId: 'n1', revisionId: 'r2', note: note('n1') })).toBe(false);
    expect(store.acceptRevision(request, { noteId: 'n2', revisionId: 'r1', note: note('n2') })).toBe(false);
    expect(store.acceptRevision(request, { noteId: 'n1', revisionId: 'r1', note: note('n1') })).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ noteId: 'n1', revisionId: 'r1', readState: { status: 'ready' } });
    const repeated = store.beginRoute('n1', 'r1');
    expect(store.acceptRevision(request, { noteId: 'n1', revisionId: 'r1', note: note('n1') })).toBe(false);
    expect(store.acceptRevision(repeated, { noteId: 'n1', revisionId: 'r1', note: note('n1') })).toBe(true);
  });

  it('does not call an unsupported or failed revision read not found', () => {
    const store = new NotebookCoreReadStore('n1');
    const request = store.beginRoute('n1', 'r1');
    expect(store.acceptRevision(request, { noteId: 'n1', revisionId: 'r1' })).toBe(true);
    expect(store.getSnapshot().readState.status).toBe('failed');
  });

  it('selects only loaded read data and never infers permission from an unknown ACL', () => {
    const store = new NotebookCoreReadStore('n1');
    expect(store.getSnapshot().readState.status).toBe('initial');
    expect(selectReadPermissions(store.getSnapshot())).toBeNull();
    const request = store.beginRoute('n1', null);
    store.acceptNote(request, note('n1'));
    const snapshot = store.getSnapshot();
    expect(selectNote(snapshot)?.id).toBe('n1');
    expect(selectParagraphOrder(snapshot)).toEqual(['p1', 'p2']);
    expect(selectParagraph(snapshot, 'p1')?.text).toBe('first');
    expect(selectSavedResults(snapshot, 'p1')).toEqual({ msg: [{ data: 'output' }] });
    expect(selectPersistedVisualization(snapshot, 'p1')).toEqual({ 0: { graph: {} } });
    expect(selectReadPermissions(snapshot)).toBeNull();
    store.acceptPermissions(request, permissions());
    expect(selectReadPermissions(store.getSnapshot())?.owners).toEqual(['owner']);
  });

  it('disposes once, rejects late results and clears subscribers', () => {
    const store = new NotebookCoreReadStore('n1');
    const listener = vi.fn();
    store.port.subscribe(listener);
    const request = store.beginRoute('n1', null);
    store.dispose();
    const disposed = store.getSnapshot();
    expect(disposed.readState.status).toBe('disposed');
    expect(listener).toHaveBeenCalledTimes(2);
    store.dispose();
    expect(store.getSnapshot()).toBe(disposed);
    expect(store.acceptNote(request, note('n1'))).toBe(false);
    expect(store.acceptPermissions(request, permissions())).toBe(false);
    expect(() => store.beginRoute('n1', null)).toThrow('disposed');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
