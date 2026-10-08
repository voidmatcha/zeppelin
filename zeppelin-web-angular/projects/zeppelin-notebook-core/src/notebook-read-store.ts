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
  NotebookCoreCommand,
  NotebookCoreCommandResult,
  NotebookCoreParagraphDraft,
  NotebookCorePatchIntent,
  NotebookCorePort,
  NotebookCoreReadSnapshot,
  NotebookCoreReadState,
  NotebookCoreRunIntent,
  NotebookCoreSnapshot,
  NotebookCoreSnapshotListener,
  NotebookCoreSaveIntent
} from './host-remote-contract';

export type NotebookCoreWireNote = Readonly<{
  id: string;
  name: string;
  path: string;
  paragraphs: readonly Readonly<{
    id: string;
    text: string;
    status: string;
    dateStarted?: string;
    results?: unknown;
  }>[];
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

/**
 * The host must prove note attribution before constructing this event. A locally
 * increasing sequence rejects repeats, but cannot attribute an implicit broadcast.
 * Never attach the current route token/note ID to an unattributed socket message.
 */
export type NotebookCoreParagraphEvent = Readonly<{ noteId: string; sequence: number }> &
  (
    | Readonly<{ type: 'insert'; paragraph: NotebookCoreWireNote['paragraphs'][number]; index: number }>
    | Readonly<{ type: 'update'; paragraph: NotebookCoreWireNote['paragraphs'][number] }>
    | Readonly<{ type: 'remove'; paragraphId: string }>
    | Readonly<{ type: 'move'; paragraphId: string; index: number }>
  );

export type NotebookCoreOutputEvent = Readonly<{
  noteId: string;
  paragraphId: string;
  sequence: number;
  index: number;
  data: string;
}> &
  (Readonly<{ kind: 'append' }> | Readonly<{ kind: 'update'; resultType: string }>);

export type NotebookCoreNoteUpdatedEvent = Readonly<{
  noteId: string;
  sequence: number;
  name: string;
  config: Readonly<Record<string, unknown>>;
  info: Readonly<Record<string, unknown>>;
}>;

export type NotebookCoreCollaborativeStatusEvent = Readonly<{
  noteId: string;
  sequence: number;
  status: boolean;
}>;

export type NotebookCorePatchEvent = Readonly<{
  noteId: string;
  paragraphId: string;
  sequence: number;
  baseText: string;
  text: string;
  applied: boolean;
  baseChecksum?: number;
  afterChecksum?: number;
}>;

type StreamResult = Readonly<{ type: string; data: string }>;
type StreamOutput = {
  results: Map<number, StreamResult>;
  pendingAppends: Map<number, string>;
};

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

const textChecksum = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return hash;
};

/**
 * Host-owned normalized note store. The host must subscribe before requesting NOTE.
 * Incremental paragraph and output events require trustworthy note attribution;
 * Collaboration patches are applied only to an attributed live paragraph.
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
  private eventSequence = -1;
  private draftVersion = 0;
  private readonly saves = new Map<string, NotebookCoreSaveIntent>();
  private readonly saveBases = new Map<string, NotebookCoreReadSnapshot['paragraphsById'][string]>();
  private readonly runs = new Map<string, NotebookCoreRunIntent>();
  private readonly runBases = new Map<string, NotebookCoreReadSnapshot['paragraphsById'][string]>();
  private readonly patches = new Map<string, NotebookCorePatchIntent>();
  private uncertainPatch = false;
  private patchFailedOnThisRoute = false;
  private readonly streamOutputs = new Map<string, StreamOutput>();

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
    // A reconnect reloads the same live note. Keep local edits until the new
    // server snapshot arrives, but never carry them into a revision or another note.
    const sameLiveNote = this.snapshot.noteId === noteId && this.snapshot.revisionId === null && revisionId === null;
    const draftsById = sameLiveNote ? this.snapshot.draftsById : undefined;
    const collaborativeMode = sameLiveNote && this.snapshot.collaborativeMode;
    this.uncertainPatch = sameLiveNote && (this.uncertainPatch || this.patches.size > 0);
    const patchFailed = sameLiveNote && (this.snapshot.collaborationPatchFailed || this.uncertainPatch);
    const request = Object.freeze({ noteId, revisionId, token: Symbol('notebook read request') });
    this.currentRequest = request;
    this.eventSequence = -1;
    this.patchFailedOnThisRoute = false;
    this.saves.clear();
    this.saveBases.clear();
    this.runs.clear();
    this.runBases.clear();
    this.patches.clear();
    this.streamOutputs.clear();
    this.acl = Object.freeze({ status: 'loading' });
    this.publish(
      Object.freeze({
        noteId,
        revisionId,
        ...(draftsById ? { draftsById } : {}),
        ...(collaborativeMode ? { collaborativeMode: true } : {}),
        ...(patchFailed ? { collaborationPatchFailed: true } : {}),
        ...(sameLiveNote && this.snapshot.collaborationPatchUnverified ? { collaborationPatchUnverified: true } : {}),
        readState: Object.freeze({ status: 'loading', acl: this.acl })
      })
    );
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

  /** Local draft/save preparation only. The host remains responsible for authorization and transport. */
  dispatch(command: NotebookCoreCommand): NotebookCoreCommandResult {
    const state = this.snapshot.readState;
    if (
      this.disposed ||
      this.snapshot.revisionId !== null ||
      state.status !== 'ready' ||
      (this.snapshot.collaborativeMode && command.type !== 'editParagraph') ||
      this.snapshot.collaborationPatchFailed ||
      this.snapshot.collaborationPatchUnverified
    ) {
      return Object.freeze({ accepted: false });
    }
    if (command.type === 'insertParagraph') {
      return Object.freeze({
        accepted:
          Number.isSafeInteger(command.index) && command.index >= 0 && command.index <= state.data.paragraphOrder.length
      });
    }
    if (!Object.prototype.hasOwnProperty.call(state.data.paragraphsById, command.paragraphId)) {
      return Object.freeze({ accepted: false });
    }
    const paragraph = state.data.paragraphsById[command.paragraphId];
    if (command.type === 'removeParagraph') {
      return Object.freeze({ accepted: state.data.paragraphOrder.length > 1 });
    }
    if (command.type === 'moveParagraph') {
      return Object.freeze({
        accepted:
          Number.isSafeInteger(command.index) &&
          command.index >= 0 &&
          command.index < state.data.paragraphOrder.length &&
          state.data.paragraphOrder[command.index] !== command.paragraphId
      });
    }
    const running = paragraph.status === 'RUNNING' || paragraph.status === 'PENDING';
    if (command.type === 'runParagraph') {
      if (running || this.runs.has(command.paragraphId)) {
        return Object.freeze({ accepted: false });
      }
      const draft = this.snapshot.draftsById?.[command.paragraphId];
      const run = Object.freeze({
        noteId: this.snapshot.noteId,
        paragraphId: command.paragraphId,
        text: draft?.text ?? paragraph.text,
        version: draft?.version ?? 0,
        token: Symbol('paragraph run')
      });
      this.runs.set(command.paragraphId, run);
      this.runBases.set(command.paragraphId, paragraph);
      return Object.freeze({ accepted: true, run });
    }
    if (command.type === 'cancelParagraph') {
      return Object.freeze({ accepted: running });
    }
    const draft = this.snapshot.draftsById?.[command.paragraphId];
    if (command.type === 'saveParagraph') {
      // One outstanding save per paragraph: the Zeppelin wire protocol does not
      // provide a client generation, so concurrent saves cannot be correlated.
      if (this.saves.has(command.paragraphId)) {
        return Object.freeze({ accepted: false });
      }
      const save = Object.freeze({
        noteId: this.snapshot.noteId,
        paragraphId: command.paragraphId,
        text: draft?.text ?? paragraph.text,
        version: draft?.version ?? 0,
        token: Symbol('paragraph save')
      });
      this.saves.set(command.paragraphId, save);
      this.saveBases.set(command.paragraphId, paragraph);
      return Object.freeze({ accepted: true, save });
    }
    if (command.text !== (draft?.text ?? paragraph.text)) {
      const drafts: Record<string, NotebookCoreParagraphDraft> = Object.assign(
        Object.create(null),
        this.snapshot.draftsById
      );
      // Keep the generation even when editing back to persisted text: an older
      // in-flight acknowledgement must not erase that newer user decision.
      drafts[command.paragraphId] = Object.freeze({ text: command.text, version: ++this.draftVersion });
      this.publish(Object.freeze({ ...this.snapshot, draftsById: Object.freeze(drafts) }));
      if (this.snapshot.collaborativeMode && !this.patches.has(command.paragraphId)) {
        const patch = this.preparePatch(command.paragraphId, paragraph.text, drafts[command.paragraphId]);
        return Object.freeze({ accepted: true, patch });
      }
    }
    return Object.freeze({ accepted: true });
  }

  /** Only the correlated server paragraph can retire a patch and release the next queued edit. */
  acceptPatchAcknowledgement(
    request: NotebookCoreReadRequest,
    patch: NotebookCorePatchIntent,
    paragraph: NotebookCoreWireNote['paragraphs'][number],
    applied: boolean
  ): NotebookCorePatchIntent | null {
    const state = this.snapshot.readState;
    if (
      !this.isLiveRequest(request) ||
      state.status !== 'ready' ||
      this.patches.get(patch.paragraphId) !== patch ||
      paragraph.id !== patch.paragraphId
    ) {
      return null;
    }
    this.patches.delete(patch.paragraphId);
    const current = state.data.paragraphsById[patch.paragraphId];
    if (
      !current ||
      !applied ||
      paragraph.text !== patch.text ||
      (current.text !== patch.baseText && current.text !== paragraph.text)
    ) {
      this.failPatch();
      return null;
    }
    const nextParagraph = cloneAndFreeze(paragraph);
    const data = Object.freeze({
      ...state.data,
      paragraphsById: Object.freeze(
        Object.assign(Object.create(null), state.data.paragraphsById, { [patch.paragraphId]: nextParagraph })
      )
    });
    const draft = this.snapshot.draftsById?.[patch.paragraphId];
    let drafts = this.snapshot.draftsById;
    if (draft?.text === paragraph.text) {
      const next = Object.assign(Object.create(null), drafts);
      delete next[patch.paragraphId];
      drafts = Object.freeze(next);
    }
    this.publish(Object.freeze({ ...this.snapshot, draftsById: drafts, readState: Object.freeze({ ...state, data }) }));
    if (!drafts?.[patch.paragraphId] || this.snapshot.collaborationPatchFailed) {
      return null;
    }
    return this.preparePatch(patch.paragraphId, paragraph.text, drafts[patch.paragraphId]);
  }

  rejectPatch(request: NotebookCoreReadRequest, patch: NotebookCorePatchIntent): boolean {
    if (!this.isLiveRequest(request) || this.patches.get(patch.paragraphId) !== patch) {
      return false;
    }
    this.patches.delete(patch.paragraphId);
    this.failPatch();
    return true;
  }

  /** Call only for a transport response correlated to this exact save intent. */
  acceptSaveAcknowledgement(
    request: NotebookCoreReadRequest,
    save: NotebookCoreSaveIntent,
    response?: NotebookCoreWireNote['paragraphs'][number]
  ): boolean {
    const state = this.snapshot.readState;
    if (
      !this.isLiveRequest(request) ||
      state.status !== 'ready' ||
      this.saves.get(save.paragraphId) !== save ||
      (response && response.id !== save.paragraphId)
    ) {
      return false;
    }
    this.saves.delete(save.paragraphId);
    const base = this.saveBases.get(save.paragraphId);
    this.saveBases.delete(save.paragraphId);
    const paragraph = state.data.paragraphsById[save.paragraphId];
    if (!paragraph) {
      return false;
    }
    const draft = this.snapshot.draftsById?.[save.paragraphId];
    let drafts = this.snapshot.draftsById;
    if (draft?.version === save.version) {
      const next = Object.assign(Object.create(null), drafts);
      delete next[save.paragraphId];
      drafts = Object.freeze(next);
    }
    // Newer server text wins over an older save response; status/output-only
    // updates do not prevent the acknowledged editor text from becoming visible.
    const newerServerText = paragraph.text !== base?.text && paragraph.text !== save.text;
    const newerServerEvent = paragraph !== base;
    const nextParagraph = newerServerText
      ? paragraph
      : newerServerEvent
        ? Object.freeze({ ...paragraph, text: save.text })
        : response
          ? cloneAndFreeze(response)
          : Object.freeze({ ...paragraph, text: save.text });
    const data = sameJsonValue(paragraph, nextParagraph)
      ? state.data
      : Object.freeze({
          ...state.data,
          paragraphsById: Object.freeze(
            Object.assign(Object.create(null), state.data.paragraphsById, { [save.paragraphId]: nextParagraph })
          )
        });
    if (data !== state.data || drafts !== this.snapshot.draftsById) {
      this.publish(
        Object.freeze({
          ...this.snapshot,
          ...(drafts ? { draftsById: drafts } : {}),
          readState: Object.freeze({ ...state, data })
        })
      );
    }
    return true;
  }

  /** Release a failed send without losing editor text or creating a false save acknowledgement. */
  rejectSave(request: NotebookCoreReadRequest, save: NotebookCoreSaveIntent): boolean {
    if (!this.isLiveRequest(request) || this.saves.get(save.paragraphId) !== save) {
      return false;
    }
    this.saves.delete(save.paragraphId);
    this.saveBases.delete(save.paragraphId);
    return true;
  }

  /** A run also persists its submitted source; only its own response may retire that draft. */
  acceptRunAcknowledgement(
    request: NotebookCoreReadRequest,
    run: NotebookCoreRunIntent,
    response: NotebookCoreWireNote['paragraphs'][number]
  ): boolean {
    const state = this.snapshot.readState;
    if (
      !this.isLiveRequest(request) ||
      state.status !== 'ready' ||
      this.runs.get(run.paragraphId) !== run ||
      response.id !== run.paragraphId
    ) {
      return false;
    }
    this.runs.delete(run.paragraphId);
    const base = this.runBases.get(run.paragraphId);
    this.runBases.delete(run.paragraphId);
    const paragraph = state.data.paragraphsById[run.paragraphId];
    if (!paragraph) {
      return false;
    }
    const draft = this.snapshot.draftsById?.[run.paragraphId];
    let drafts = this.snapshot.draftsById;
    if (draft?.version === run.version) {
      const next = Object.assign(Object.create(null), drafts);
      delete next[run.paragraphId];
      drafts = Object.freeze(next);
    }
    const newerServerText = paragraph.text !== base?.text && paragraph.text !== run.text;
    const nextParagraph = newerServerText
      ? paragraph
      : paragraph !== base
        ? Object.freeze({ ...paragraph, text: run.text })
        : cloneAndFreeze(response);
    const data = sameJsonValue(paragraph, nextParagraph)
      ? state.data
      : Object.freeze({
          ...state.data,
          paragraphsById: Object.freeze(
            Object.assign(Object.create(null), state.data.paragraphsById, { [run.paragraphId]: nextParagraph })
          )
        });
    if (data !== state.data || drafts !== this.snapshot.draftsById) {
      this.publish(
        Object.freeze({
          ...this.snapshot,
          ...(drafts ? { draftsById: drafts } : {}),
          readState: Object.freeze({ ...state, data })
        })
      );
    }
    return true;
  }

  rejectRun(request: NotebookCoreReadRequest, run: NotebookCoreRunIntent): boolean {
    if (!this.isLiveRequest(request) || this.runs.get(run.paragraphId) !== run) {
      return false;
    }
    this.runs.delete(run.paragraphId);
    this.runBases.delete(run.paragraphId);
    return true;
  }

  acceptNoteUpdated(request: NotebookCoreReadRequest, event: NotebookCoreNoteUpdatedEvent): boolean {
    const state = this.snapshot.readState;
    if (
      !this.isLiveRequest(request) ||
      state.status !== 'ready' ||
      event.noteId !== request.noteId ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= this.eventSequence
    ) {
      return false;
    }
    const note = state.data.note;
    const nextNote = { ...note, name: event.name, config: event.config, info: event.info };
    this.eventSequence = event.sequence;
    if (!sameJsonValue(note, nextNote)) {
      this.publish(
        Object.freeze({
          ...this.snapshot,
          readState: Object.freeze({
            ...state,
            data: Object.freeze({ ...state.data, note: cloneAndFreeze(nextNote) })
          })
        })
      );
    }
    return true;
  }

  acceptCollaborativeStatus(request: NotebookCoreReadRequest, event: NotebookCoreCollaborativeStatusEvent): boolean {
    if (
      !this.isLiveRequest(request) ||
      event.noteId !== request.noteId ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= this.eventSequence
    ) {
      return false;
    }
    this.eventSequence = event.sequence;
    // An ignored patch may have changed the server source. A later "false"
    // cannot make this stale view safe to edit without a fresh route read.
    const blocked = this.snapshot.collaborativeMode === true || event.status;
    if (this.snapshot.collaborativeMode !== blocked) {
      this.publish(Object.freeze({ ...this.snapshot, collaborativeMode: blocked }));
    }
    return true;
  }

  /** Preserve local drafts and fail closed if a patch cannot be verified against this view. */
  acceptPatchEvent(request: NotebookCoreReadRequest, event: NotebookCorePatchEvent): boolean {
    const state = this.snapshot.readState;
    if (
      !this.isLiveRequest(request) ||
      event.noteId !== request.noteId ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= this.eventSequence ||
      typeof event.baseText !== 'string' ||
      typeof event.text !== 'string' ||
      typeof event.applied !== 'boolean' ||
      this.snapshot.collaborationPatchFailed
    ) {
      return false;
    }
    this.eventSequence = event.sequence;
    const fail = () => {
      this.patchFailedOnThisRoute = true;
      this.publish(Object.freeze({ ...this.snapshot, collaborativeMode: true, collaborationPatchFailed: true }));
      return false;
    };
    if (state.status !== 'ready') {
      return fail();
    }
    const paragraph = state.data.paragraphsById[event.paragraphId];
    if (!paragraph || !event.applied || event.baseText !== paragraph.text) {
      return fail();
    }
    if (
      (event.baseChecksum !== undefined &&
        (!Number.isSafeInteger(event.baseChecksum) || event.baseChecksum !== textChecksum(paragraph.text))) ||
      (event.afterChecksum !== undefined && !Number.isSafeInteger(event.afterChecksum))
    ) {
      return fail();
    }
    if (event.afterChecksum !== undefined && event.afterChecksum !== textChecksum(event.text)) {
      return fail();
    }
    const nextParagraph = Object.freeze({ ...paragraph, text: event.text });
    const data = Object.freeze({
      ...state.data,
      paragraphsById: Object.freeze(
        Object.assign(Object.create(null), state.data.paragraphsById, { [event.paragraphId]: nextParagraph })
      )
    });
    this.publish(
      Object.freeze({
        ...this.snapshot,
        collaborativeMode: true,
        collaborationPatchUnverified:
          this.snapshot.collaborationPatchUnverified ||
          event.baseChecksum === undefined ||
          event.afterChecksum === undefined,
        readState: Object.freeze({ ...state, data })
      })
    );
    return true;
  }

  acceptParagraphEvent(request: NotebookCoreReadRequest, event: NotebookCoreParagraphEvent): boolean {
    const state = this.snapshot.readState;
    if (
      !this.isLiveRequest(request) ||
      state.status !== 'ready' ||
      event.noteId !== request.noteId ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= this.eventSequence
    ) {
      return false;
    }
    const data = state.data;
    let order = data.paragraphOrder;
    let paragraphs = data.paragraphsById;
    let drafts = this.snapshot.draftsById;
    if (event.type === 'insert') {
      if (!Number.isInteger(event.index) || event.index < 0 || event.index > order.length) {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(paragraphs, event.paragraph.id)) {
        // Replayed insertion is harmless only if both its location and payload match.
        if (
          order[event.index] !== event.paragraph.id ||
          !sameJsonValue(paragraphs[event.paragraph.id], event.paragraph)
        ) {
          return false;
        }
      } else {
        order = Object.freeze([...order.slice(0, event.index), event.paragraph.id, ...order.slice(event.index)]);
        paragraphs = Object.freeze(
          Object.assign(Object.create(null), paragraphs, {
            [event.paragraph.id]: cloneAndFreeze(event.paragraph)
          })
        );
      }
    } else if (event.type === 'update') {
      if (!Object.prototype.hasOwnProperty.call(paragraphs, event.paragraph.id)) {
        return false;
      }
      const previous = paragraphs[event.paragraph.id];
      const wireParagraph = event.paragraph as typeof event.paragraph & { results?: { msg?: StreamResult[] } };
      const serverResults = wireParagraph.results?.msg;
      if ((event.paragraph.status === 'RUNNING' || event.paragraph.status === 'PENDING') && serverResults?.length) {
        this.streamOutputs.set(event.paragraph.id, {
          results: new Map(serverResults.map((result, index) => [index, result])),
          pendingAppends: new Map()
        });
      } else {
        // A full PARAGRAPH is authoritative, including an output clear while RUNNING.
        this.streamOutputs.delete(event.paragraph.id);
      }
      if (!sameJsonValue(previous, event.paragraph)) {
        paragraphs = Object.freeze(
          Object.assign(Object.create(null), paragraphs, {
            [event.paragraph.id]: cloneAndFreeze(event.paragraph)
          })
        );
      }
    } else if (event.type === 'move') {
      const from = order.indexOf(event.paragraphId);
      if (from < 0 || !Number.isInteger(event.index) || event.index < 0 || event.index >= order.length) {
        return false;
      }
      if (from !== event.index) {
        const next = order.filter(id => id !== event.paragraphId);
        next.splice(event.index, 0, event.paragraphId);
        order = Object.freeze(next);
      }
    } else if (Object.prototype.hasOwnProperty.call(paragraphs, event.paragraphId)) {
      order = Object.freeze(order.filter(id => id !== event.paragraphId));
      const next = Object.assign(Object.create(null), paragraphs);
      delete next[event.paragraphId];
      paragraphs = Object.freeze(next);
      this.saves.delete(event.paragraphId);
      this.saveBases.delete(event.paragraphId);
      this.runs.delete(event.paragraphId);
      this.runBases.delete(event.paragraphId);
      this.streamOutputs.delete(event.paragraphId);
      if (drafts?.[event.paragraphId]) {
        const nextDrafts = Object.assign(Object.create(null), drafts);
        delete nextDrafts[event.paragraphId];
        drafts = Object.freeze(nextDrafts);
      }
    }
    this.eventSequence = event.sequence;
    if (order !== data.paragraphOrder || paragraphs !== data.paragraphsById) {
      this.publish(
        Object.freeze({
          ...this.snapshot,
          ...(drafts ? { draftsById: drafts } : {}),
          readState: Object.freeze({
            ...state,
            data: Object.freeze({ ...data, paragraphOrder: order, paragraphsById: paragraphs })
          })
        })
      );
    }
    return true;
  }

  /** Apply only note-attributed output in socket order; an untyped append stays buffered. */
  acceptOutputEvent(request: NotebookCoreReadRequest, event: NotebookCoreOutputEvent): boolean {
    const state = this.snapshot.readState;
    if (
      !this.isLiveRequest(request) ||
      state.status !== 'ready' ||
      event.noteId !== request.noteId ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= this.eventSequence ||
      !Number.isSafeInteger(event.index) ||
      event.index < 0 ||
      typeof event.data !== 'string' ||
      (event.kind === 'update' && typeof event.resultType !== 'string')
    ) {
      return false;
    }
    const paragraph = state.data.paragraphsById[event.paragraphId];
    if (!paragraph || ['FINISHED', 'ERROR', 'ABORT'].includes(paragraph.status)) {
      return false;
    }
    const existing = paragraph.results as { msg?: StreamResult[] } | undefined;
    let output = this.streamOutputs.get(event.paragraphId);
    if (!output) {
      const active = paragraph.status === 'RUNNING' || paragraph.status === 'PENDING';
      output = { results: new Map(), pendingAppends: new Map() };
      if (active) {
        existing?.msg?.forEach((result, index) => output!.results.set(index, result));
      }
      this.streamOutputs.set(event.paragraphId, output);
    }
    this.eventSequence = event.sequence;
    if (event.kind === 'append') {
      const current = output.results.get(event.index);
      if (current) {
        output.results.set(event.index, { ...current, data: current.data + event.data });
      } else {
        output.pendingAppends.set(event.index, (output.pendingAppends.get(event.index) ?? '') + event.data);
        return true;
      }
    } else {
      output.results.set(event.index, {
        type: event.resultType,
        data: event.data === '' ? (output.pendingAppends.get(event.index) ?? '') : event.data
      });
      output.pendingAppends.delete(event.index);
    }
    const visible = visibleStreamResults(output);
    if (sameJsonValue(existing?.msg ?? [], visible)) {
      return true;
    }
    const nextParagraph = Object.freeze({
      ...paragraph,
      results: cloneAndFreeze({ ...(paragraph.results as object | undefined), msg: visible })
    });
    const data = Object.freeze({
      ...state.data,
      paragraphsById: Object.freeze(
        Object.assign(Object.create(null), state.data.paragraphsById, { [event.paragraphId]: nextParagraph })
      )
    });
    this.publish(Object.freeze({ ...this.snapshot, readState: Object.freeze({ ...state, data }) }));
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.currentRequest = null;
    this.saves.clear();
    this.saveBases.clear();
    this.runs.clear();
    this.runBases.clear();
    this.patches.clear();
    this.streamOutputs.clear();
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

  private preparePatch(
    paragraphId: string,
    baseText: string,
    draft: NotebookCoreParagraphDraft
  ): NotebookCorePatchIntent {
    const patch = Object.freeze({
      noteId: this.snapshot.noteId,
      paragraphId,
      baseText,
      text: draft.text,
      version: draft.version,
      token: Symbol('paragraph patch')
    });
    this.patches.set(paragraphId, patch);
    return patch;
  }

  private failPatch(): void {
    this.patchFailedOnThisRoute = true;
    this.publish(Object.freeze({ ...this.snapshot, collaborativeMode: true, collaborationPatchFailed: true }));
  }

  private isLiveRequest(request: NotebookCoreReadRequest): boolean {
    return !this.disposed && request === this.currentRequest && request.revisionId === null;
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
    let drafts = this.snapshot.draftsById;
    for (const paragraphId of Array.from(this.saves.keys())) {
      if (!Object.prototype.hasOwnProperty.call(paragraphsById, paragraphId)) {
        this.saves.delete(paragraphId);
        this.saveBases.delete(paragraphId);
      }
    }
    if (drafts && Object.keys(drafts).some(id => !Object.prototype.hasOwnProperty.call(paragraphsById, id))) {
      const nextDrafts: Record<string, NotebookCoreParagraphDraft> = Object.create(null);
      for (const id of Object.keys(drafts)) {
        if (Object.prototype.hasOwnProperty.call(paragraphsById, id)) {
          nextDrafts[id] = drafts[id];
        }
      }
      drafts = Object.freeze(nextDrafts);
    }
    const unsentCollaborativeDraft =
      this.snapshot.collaborativeMode &&
      drafts &&
      Object.entries(drafts).some(([id, draft]) => paragraphsById[id]?.text !== draft.text);
    this.publish(
      Object.freeze({
        ...this.snapshot,
        collaborationPatchFailed:
          this.uncertainPatch ||
          this.patchFailedOnThisRoute ||
          (this.snapshot.collaborationPatchFailed && unsentCollaborativeDraft) ||
          undefined,
        collaborationPatchUnverified: undefined,
        ...(drafts ? { draftsById: drafts } : {}),
        readState: Object.freeze({ status: 'ready', data: read, acl: this.acl })
      })
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

const visibleStreamResults = (output: StreamOutput): StreamResult[] => {
  const visible: StreamResult[] = [];
  while (output.results.has(visible.length)) {
    visible.push(output.results.get(visible.length)!);
  }
  return visible;
};
