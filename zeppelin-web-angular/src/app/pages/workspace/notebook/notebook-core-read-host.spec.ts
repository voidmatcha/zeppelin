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

import { Observable, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OP } from '@zeppelin/sdk';
import type { MessageService, SecurityService } from '@zeppelin/services';
import { NotebookCoreReadHost } from './notebook-core-read-host';

const note = (id: string, name = id) => ({
  id,
  name,
  path: `/${name}`,
  paragraphs: [{ id: 'p1', text: 'hello', status: 'FINISHED', results: { msg: [{ type: 'TEXT', data: 'saved' }] } }]
});

const createHost = (
  onSend?: (msgId: string) => void,
  permissions$?: Observable<{ readers: string[]; owners: string[]; writers: string[]; runners: string[] }>
) => {
  const received = new Subject<{ op: OP; msgId?: string; data?: unknown }>();
  let sequence = 0;
  const message = {
    received: () => received.asObservable(),
    isNotebookCoreCommitRequestId: (msgId: string) => msgId.startsWith('commit-'),
    sendNotebookCoreRead: (register: (msgId: string) => void) => {
      const msgId = `request-${++sequence}`;
      register(msgId);
      onSend?.(msgId);
      return msgId;
    },
    sendNotebookCoreCommit: vi.fn((register: (msgId: string) => void) => {
      const msgId = `commit-${++sequence}`;
      register(msgId);
      return msgId;
    })
  };
  const security = {
    getPermissions: vi.fn(() => permissions$ ?? of({ readers: ['alice'], owners: [], writers: [], runners: [] }))
  };
  const host = new NotebookCoreReadHost(message as unknown as MessageService, security as unknown as SecurityService);
  return { host, received, security, message };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('NotebookCoreReadHost', () => {
  it('registers before a synchronous NOTE response and publishes one Core snapshot', () => {
    let received: Subject<{ op: OP; msgId?: string; data?: unknown }>;
    const fixture = createHost(msgId => received.next({ op: OP.NOTE, msgId, data: { note: note('a') } }));
    received = fixture.received;
    const { host } = fixture;

    host.load('a', null);

    expect(host.port.getSnapshot().readState?.status).toBe('ready');
    expect(host.store.getSnapshot().readState.status).toBe('ready');
    host.destroy();
  });

  it('ignores stale, duplicate and uncorrelated NOTE replies after A to B to A', () => {
    const { host, received } = createHost();
    host.load('a', null);
    host.load('b', null);
    host.load('a', null);

    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a', 'old') } });
    received.next({ op: OP.NOTE, msgId: 'request-2', data: { note: note('b') } });
    received.next({ op: OP.NOTE, data: { note: note('a', 'broadcast') } });
    expect(host.store.getSnapshot().readState.status).toBe('loading');

    received.next({ op: OP.NOTE, msgId: 'request-3', data: { note: note('a', 'new') } });
    received.next({ op: OP.NOTE, msgId: 'request-3', data: { note: note('a', 'duplicate') } });
    const state = host.store.getSnapshot().readState;
    expect(state.status).toBe('ready');
    expect(state.status === 'ready' && state.data.note.name).toBe('new');
    expect(state.acl.status).toBe('ready');
    host.destroy();
  });

  it('accepts only the requested revision and maps correlated errors', () => {
    const { host, received } = createHost();
    host.load('a', 'rev-1');
    received.next({
      op: OP.NOTE_REVISION,
      msgId: 'request-1',
      data: { noteId: 'a', revisionId: 'rev-2', note: note('a') }
    });
    expect(host.store.getSnapshot().readState.status).toBe('loading');
    received.next({ op: OP.ERROR_INFO, msgId: 'request-1', data: { errorType: 'NOTE_NOT_FOUND' } });
    expect(host.store.getSnapshot().readState.status).toBe('notFound');
    host.destroy();
  });

  it('invalidates pending replies when the connection closes', () => {
    const { host, received } = createHost();
    host.load('a', null);
    host.invalidate();
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });
    expect(host.store.getSnapshot().readState.status).toBe('failed');
    host.destroy();
  });

  it('times out a missing read response', () => {
    vi.useFakeTimers();
    const { host } = createHost();
    host.load('a', null);
    vi.advanceTimersByTime(10000);
    expect(host.store.getSnapshot().readState.status).toBe('failed');
    host.destroy();
  });

  it('settles permissions as failed when the ACL request never responds', () => {
    vi.useFakeTimers();
    const permissions = new Subject<{ readers: string[]; owners: string[]; writers: string[]; runners: string[] }>();
    const { host, received } = createHost(undefined, permissions);
    host.load('a', null);
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });
    vi.advanceTimersByTime(10000);
    expect(host.store.getSnapshot().readState.acl.status).toBe('failed');
    host.destroy();
  });

  it('keeps a repeated revision read isolated from late replies and ACL results', () => {
    const permissions = [
      new Subject<{
        readers: string[];
        owners: string[];
        writers: string[];
        runners: string[];
      }>(),
      new Subject<{
        readers: string[];
        owners: string[];
        writers: string[];
        runners: string[];
      }>()
    ];
    const { host, received, security } = createHost();
    let permissionIndex = 0;
    security.getPermissions.mockImplementation(() => permissions[permissionIndex++].asObservable());
    host.load('a', 'rev-1');
    host.load('a', 'rev-1');
    // The first subscription has been cancelled, so only the second response may publish.
    permissions[0].next({ readers: ['old'], owners: [], writers: [], runners: [] });
    received.next({
      op: OP.NOTE_REVISION,
      msgId: 'request-1',
      data: { noteId: 'a', revisionId: 'rev-1', note: note('a', 'old') }
    });
    expect(host.store.getSnapshot().readState.status).toBe('loading');
    received.next({
      op: OP.NOTE_REVISION,
      msgId: 'request-2',
      data: { noteId: 'a', revisionId: 'rev-1', note: note('a', 'new') }
    });
    const state = host.store.getSnapshot().readState;
    expect(state.status === 'ready' && state.data.note.name).toBe('new');
    expect(state.acl.status).toBe('loading');
    permissions[1].next({ readers: ['new'], owners: [], writers: [], runners: [] });
    const settled = host.store.getSnapshot().readState;
    expect(settled.acl.status === 'ready' && settled.acl.permissions.readers).toEqual(['new']);
    host.destroy();
  });

  it('treats malformed NOTE as failure rather than a missing note', () => {
    const { host, received } = createHost();
    host.load('a', null);
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: { id: 'a' } } });
    expect(host.store.getSnapshot().readState.status).toBe('failed');
    host.destroy();
  });

  it('cannot update a disposed Core after a delayed response', () => {
    const { host, received } = createHost();
    host.load('a', null);
    host.destroy();
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });
    expect(host.store.getSnapshot().readState.status).toBe('disposed');
  });

  it('publishes attributed paragraph changes to the shared Angular and React port', () => {
    const { host, received } = createHost();
    host.load('a', null);
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });

    const added = { id: 'p2', text: 'second', status: 'READY' };
    received.next({ op: OP.PARAGRAPH_ADDED, data: { noteId: 'other', index: 1, paragraph: added } });
    received.next({ op: OP.PARAGRAPH_ADDED, data: { index: 1, paragraph: added } });
    const initial = host.store.getSnapshot().readState;
    expect(initial.status).toBe('ready');
    expect(initial.status === 'ready' && initial.data.paragraphOrder).toEqual(['p1']);

    received.next({ op: OP.PARAGRAPH_ADDED, data: { noteId: 'a', index: 1, paragraph: added } });
    received.next({ op: OP.PARAGRAPH_MOVED, data: { noteId: 'a', id: 'p2', index: 0 } });
    const moved = host.port.getSnapshot().readState;
    expect(moved?.status === 'ready' && moved.data.paragraphOrder).toEqual(['p2', 'p1']);

    received.next({ op: OP.PARAGRAPH, data: { noteId: 'a', paragraph: { ...added, text: 'updated' } } });
    const updated = host.port.getSnapshot().readState;
    expect(updated?.status === 'ready' && updated.data.paragraphsById.p2.text).toBe('updated');

    received.next({ op: OP.PARAGRAPH_REMOVED, data: { noteId: 'a', id: 'p2' } });
    const removed = host.port.getSnapshot().readState;
    expect(removed?.status === 'ready' && removed.data.paragraphOrder).toEqual(['p1']);
    host.destroy();
  });

  it('normalizes an empty paragraph in a full note and a later insert', () => {
    const { host, received } = createHost();
    host.load('a', null);
    received.next({
      op: OP.NOTE,
      msgId: 'request-1',
      data: { note: { ...note('a'), paragraphs: [{ id: 'p1', status: 'READY' }] } }
    });
    const loaded = host.port.getSnapshot().readState;
    expect(loaded?.status === 'ready' && loaded.data.paragraphsById.p1.text).toBe('');
    received.next({
      op: OP.PARAGRAPH_ADDED,
      data: { noteId: 'a', index: 1, paragraph: { id: 'p2', status: 'READY' } }
    });
    const inserted = host.port.getSnapshot().readState;
    expect(inserted?.status === 'ready' && inserted.data.paragraphsById.p2.text).toBe('');
    received.next({
      op: OP.PARAGRAPH,
      data: { noteId: 'a', paragraph: { id: 'p2', text: 'now edited', status: 'READY' } }
    });
    const edited = host.port.getSnapshot().readState;
    expect(edited?.status === 'ready' && edited.data.paragraphsById.p2.text).toBe('now edited');
    host.destroy();
  });

  it('does not apply live paragraph changes to a saved revision', () => {
    const { host, received } = createHost();
    host.load('a', 'rev-1');
    received.next({
      op: OP.NOTE_REVISION,
      msgId: 'request-1',
      data: { noteId: 'a', revisionId: 'rev-1', note: note('a') }
    });
    const before = host.port.getSnapshot();
    received.next({ op: OP.PARAGRAPH_REMOVED, data: { noteId: 'a', id: 'p1' } });
    expect(host.port.getSnapshot()).toBe(before);
    host.destroy();
  });

  it('routes an attributed save response through the Core without losing newer editor text', () => {
    const { host, received, message } = createHost();
    host.load('a', null);
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });

    expect(host.commandPort.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'first edit' })).toEqual({
      accepted: true
    });
    const save = host.commandPort.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    expect(save.accepted).toBe(true);
    expect(message.sendNotebookCoreCommit).toHaveBeenCalledWith(
      expect.any(Function),
      OP.COMMIT_PARAGRAPH,
      expect.objectContaining({ id: 'p1', noteId: 'a', paragraph: 'first edit' })
    );
    host.commandPort.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'newer edit' });
    received.next({
      op: OP.PARAGRAPH,
      msgId: 'commit-2',
      data: { noteId: 'a', paragraph: { id: 'p1', text: 'first edit', status: 'FINISHED' } }
    });

    const snapshot = host.commandPort.getSnapshot();
    expect(snapshot.readState?.status === 'ready' && snapshot.readState.data.paragraphsById.p1.text).toBe('first edit');
    expect(snapshot.draftsById?.p1.text).toBe('newer edit');
    host.destroy();
  });

  it('does not let a late save response revert a newer server paragraph', () => {
    const { host, received } = createHost();
    host.load('a', null);
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });
    host.commandPort.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'saved edit' });
    host.commandPort.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    received.next({
      op: OP.PARAGRAPH,
      data: { noteId: 'a', paragraph: { id: 'p1', text: 'collaborator edit', status: 'RUNNING' } }
    });
    received.next({
      op: OP.PARAGRAPH,
      msgId: 'commit-2',
      data: { noteId: 'a', paragraph: { id: 'p1', text: 'saved edit', status: 'READY' } }
    });
    const state = host.port.getSnapshot().readState;
    expect(state?.status === 'ready' && state.data.paragraphsById.p1).toMatchObject({
      text: 'collaborator edit',
      status: 'RUNNING'
    });
    host.destroy();
  });

  it('releases a failed save for retry while keeping its local draft', () => {
    const { host, received } = createHost();
    host.load('a', null);
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });
    host.commandPort.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'unsaved edit' });
    expect(host.commandPort.dispatch({ type: 'saveParagraph', paragraphId: 'p1' }).accepted).toBe(true);

    received.next({ op: OP.AUTH_INFO, msgId: 'commit-2', data: { errorType: 'FORBIDDEN' } });

    expect(host.commandPort.getSnapshot().draftsById?.p1.text).toBe('unsaved edit');
    expect(host.commandPort.dispatch({ type: 'saveParagraph', paragraphId: 'p1' }).accepted).toBe(true);
    host.destroy();
  });

  it('rejects a delayed save reply after leaving its note', () => {
    const { host, received } = createHost();
    host.load('a', null);
    received.next({ op: OP.NOTE, msgId: 'request-1', data: { note: note('a') } });
    host.commandPort.dispatch({ type: 'editParagraph', paragraphId: 'p1', text: 'old draft' });
    host.commandPort.dispatch({ type: 'saveParagraph', paragraphId: 'p1' });
    host.load('b', null);
    received.next({ op: OP.NOTE, msgId: 'request-3', data: { note: note('b') } });
    const before = host.commandPort.getSnapshot();
    received.next({
      op: OP.PARAGRAPH,
      msgId: 'commit-2',
      data: { noteId: 'a', paragraph: { id: 'p1', text: 'old draft', status: 'FINISHED' } }
    });
    expect(host.commandPort.getSnapshot()).toBe(before);
    host.destroy();
  });
});
