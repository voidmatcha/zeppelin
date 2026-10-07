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

import type {
  NotebookCoreAclState,
  NotebookCorePort,
  NotebookCoreReadSnapshot,
  NotebookCoreReadState,
  NotebookCoreSnapshot,
  NotebookCoreSnapshotListener
} from './host-remote-contract';

export type NotebookCoreWireNote = Readonly<{
  id: string;
  name: string;
  path: string;
  paragraphs: readonly Readonly<{ id: string; text: string; status: string }>[];
}>;

export type NotebookCoreWirePermissions = Readonly<{
  readers: readonly string[];
  owners: readonly string[];
  writers: readonly string[];
  runners: readonly string[];
}>;

/** Bind this context to the request callback that issued NOTE, NOTE_REVISION or ACL. */
export type NotebookCoreReadRequest = Readonly<{
  noteId: string;
  revisionId: string | null;
  token: symbol;
}>;

export type NotebookCoreWireRevision = Readonly<{
  noteId: string;
  revisionId: string;
  note?: NotebookCoreWireNote;
}>;

type ReadSnapshot = NotebookCoreSnapshot & Readonly<{ readState: NotebookCoreReadState }>;

const cloneAndFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // WebSocket and REST payloads are JSON values. Cloning keeps the Core from
  // sharing mutable objects with the host's message handlers.
  const cloned = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) {
      return;
    }
    for (const child of Object.values(item)) {
      freeze(child);
    }
    Object.freeze(item);
  };
  freeze(cloned);
  return cloned;
};

const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    );
  }
  const leftFields = left as Record<string, unknown>;
  const rightFields = right as Record<string, unknown>;
  const keys = Object.keys(leftFields);
  return (
    keys.length === Object.keys(rightFields).length &&
    keys.every(
      key => Object.prototype.hasOwnProperty.call(rightFields, key) && sameJsonValue(leftFields[key], rightFields[key])
    )
  );
};

/**
 * Host-owned snapshot-only store. Its inputs are full NOTE, NOTE_REVISION and ACL read results.
 * Paragraph events, streaming, collaboration and metadata broadcasts require a fresh read;
 * they are not incremental reducers here. The host must subscribe before requesting NOTE.
 */
export class NotebookCoreReadStore {
  readonly port: NotebookCorePort = Object.freeze({
    getSnapshot: () => this.snapshot,
    subscribe: (listener: NotebookCoreSnapshotListener) => {
      if (this.disposed) {
        return () => undefined;
      }
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  });
  private snapshot: ReadSnapshot;
  private readonly listeners = new Set<NotebookCoreSnapshotListener>();
  private currentRequest: NotebookCoreReadRequest | null = null;
  private acl: NotebookCoreAclState = Object.freeze({ status: 'loading' });
  private disposed = false;

  constructor(noteId: string, revisionId: string | null = null) {
    this.snapshot = Object.freeze({
      noteId,
      revisionId,
      readState: Object.freeze({ status: 'initial', acl: this.acl })
    });
  }

  readonly getSnapshot = (): ReadSnapshot => this.snapshot;

  /** Start fresh requests on every route visit, including A -> B -> A. */
  beginRoute(noteId: string, revisionId: string | null): NotebookCoreReadRequest {
    if (this.disposed) {
      throw new Error('Notebook Core has been disposed');
    }
    const request = Object.freeze({ noteId, revisionId, token: Symbol('notebook read request') });
    this.currentRequest = request;
    this.acl = Object.freeze({ status: 'loading' });
    this.publish(Object.freeze({ noteId, revisionId, readState: Object.freeze({ status: 'loading', acl: this.acl }) }));
    return request;
  }

  /** A WebSocket NOTE without trustworthy request attribution must not be given the current token. */
  acceptNote(request: NotebookCoreReadRequest, note: NotebookCoreWireNote): boolean {
    if (request !== this.currentRequest || request.revisionId !== null || note.id !== request.noteId) {
      return false;
    }
    this.acceptFullNote(note);
    return true;
  }

  acceptRevision(request: NotebookCoreReadRequest, revision: NotebookCoreWireRevision): boolean {
    if (
      request !== this.currentRequest ||
      request.revisionId === null ||
      revision.noteId !== request.noteId ||
      revision.revisionId !== request.revisionId
    ) {
      return false;
    }
    if (!revision.note) {
      // A missing note can also mean the backing repository does not support revisions.
      return this.acceptNoteFailure(request, 'failed');
    }
    if (revision.note.id !== request.noteId) {
      return false;
    }
    this.acceptFullNote(revision.note);
    return true;
  }

  acceptNoteFailure(request: NotebookCoreReadRequest, status: 'notFound' | 'accessDenied' | 'failed'): boolean {
    if (request !== this.currentRequest) {
      return false;
    }
    if (this.snapshot.readState.status !== status) {
      this.publish(Object.freeze({ ...this.snapshot, readState: Object.freeze({ status, acl: this.acl }) }));
    }
    return true;
  }

  acceptPermissions(request: NotebookCoreReadRequest, permissions: NotebookCoreWirePermissions): boolean {
    if (request !== this.currentRequest) {
      return false;
    }
    if (this.acl.status === 'ready' && samePermissions(this.acl.permissions, permissions)) {
      return true;
    }
    this.acl = Object.freeze({ status: 'ready', permissions: cloneAndFreeze(permissions) });
    this.publishAcl();
    return true;
  }

  acceptPermissionsFailure(request: NotebookCoreReadRequest, status: 'accessDenied' | 'failed'): boolean {
    if (request !== this.currentRequest) {
      return false;
    }
    if (this.acl.status === status) {
      return true;
    }
    this.acl = Object.freeze({ status });
    this.publishAcl();
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.currentRequest = null;
    this.acl = Object.freeze({ status: 'loading' });
    this.publish(
      Object.freeze({
        noteId: this.snapshot.noteId,
        revisionId: this.snapshot.revisionId,
        readState: Object.freeze({ status: 'disposed', acl: this.acl })
      })
    );
    this.listeners.clear();
  }

  private acceptFullNote(note: NotebookCoreWireNote): void {
    const current = this.snapshot.readState;
    if (current.status === 'ready' && current.data.paragraphOrder.length === note.paragraphs.length) {
      const { paragraphs, ...noteFields } = note;
      if (
        sameJsonValue(current.data.note, noteFields) &&
        paragraphs.every(
          (paragraph, index) =>
            current.data.paragraphOrder[index] === paragraph.id &&
            sameJsonValue(current.data.paragraphsById[paragraph.id], paragraph)
        )
      ) {
        return;
      }
    }
    const { paragraphs, ...noteFields } = cloneAndFreeze(note);
    const paragraphsById: Record<
      string,
      Readonly<{ id: string; text: string; status: string } & Record<string, unknown>>
    > = Object.create(null);
    const paragraphOrder: string[] = [];
    for (const paragraph of paragraphs) {
      if (Object.prototype.hasOwnProperty.call(paragraphsById, paragraph.id)) {
        throw new Error(`Duplicate paragraph ID: ${paragraph.id}`);
      }
      paragraphsById[paragraph.id] =
        current.status === 'ready' && sameJsonValue(current.data.paragraphsById[paragraph.id], paragraph)
          ? current.data.paragraphsById[paragraph.id]
          : paragraph;
      paragraphOrder.push(paragraph.id);
    }
    const read: NotebookCoreReadSnapshot = Object.freeze({
      note:
        current.status === 'ready' && sameJsonValue(current.data.note, noteFields)
          ? current.data.note
          : Object.freeze(noteFields),
      paragraphOrder:
        current.status === 'ready' && sameJsonValue(current.data.paragraphOrder, paragraphOrder)
          ? current.data.paragraphOrder
          : Object.freeze(paragraphOrder),
      paragraphsById: Object.freeze(paragraphsById)
    });
    this.publish(
      Object.freeze({ ...this.snapshot, readState: Object.freeze({ status: 'ready', data: read, acl: this.acl }) })
    );
  }

  private publishAcl(): void {
    const readState = this.snapshot.readState;
    this.publish(Object.freeze({ ...this.snapshot, readState: Object.freeze({ ...readState, acl: this.acl }) }));
  }

  private publish(snapshot: ReadSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

const samePermissions = (left: NotebookCoreWirePermissions, right: NotebookCoreWirePermissions): boolean =>
  (['readers', 'owners', 'writers', 'runners'] as const).every(
    key => left[key].length === right[key].length && left[key].every((value, index) => value === right[key][index])
  );
