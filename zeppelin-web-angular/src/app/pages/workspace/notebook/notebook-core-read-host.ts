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

import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subscription } from 'rxjs';
import { take, timeout } from 'rxjs/operators';

import {
  NotebookCoreCommand,
  NotebookCoreCommandPort,
  NotebookCoreCommandResult,
  NotebookCoreReadRequest,
  NotebookCoreReadStore,
  NotebookCoreRunIntent,
  NotebookCoreSaveIntent,
  NotebookCoreWireNote
} from '@zeppelin/notebook-core';
import { Note, NoteRevision, OP, ParagraphConfig } from '@zeppelin/sdk';
import { MessageService, SecurityService } from '@zeppelin/services';

const READ_TIMEOUT_MS = 10000;

/** The Angular host owns transport and the sole Core instance for this route lifetime. */
export class NotebookCoreReadHost {
  readonly store = new NotebookCoreReadStore('');
  readonly port = this.store.port;
  readonly commandPort: NotebookCoreCommandPort = Object.freeze({
    ...this.store.port,
    dispatch: (command: NotebookCoreCommand) => this.dispatch(command)
  });
  readonly snapshot$ = new Observable<ReturnType<NotebookCoreReadStore['getSnapshot']>>(subscriber => {
    subscriber.next(this.store.getSnapshot());
    return this.store.port.subscribe(() => subscriber.next(this.store.getSnapshot()));
  });

  private readonly subscriptions = new Subscription();
  private permissionSubscription?: Subscription;
  private pending = new Map<string, { request: NotebookCoreReadRequest; timeout: ReturnType<typeof setTimeout> }>();
  private pendingSaves = new Map<
    string,
    { request: NotebookCoreReadRequest; save: NotebookCoreSaveIntent; timeout: ReturnType<typeof setTimeout> }
  >();
  private pendingRuns = new Map<
    string,
    { request: NotebookCoreReadRequest; run: NotebookCoreRunIntent; timeout: ReturnType<typeof setTimeout> }
  >();
  private currentRequest?: NotebookCoreReadRequest;
  private wireSequence = 0;

  constructor(
    private readonly message: MessageService,
    private readonly security: SecurityService
  ) {
    // Install the listener before the first read can be sent.
    this.subscriptions.add(this.message.received().subscribe(envelope => this.receive(envelope)));
  }

  load(noteId: string, revisionId: string | null): void {
    this.clearPending();
    this.clearPendingSaves();
    this.clearPendingRuns();
    this.permissionSubscription?.unsubscribe();
    const request = this.store.beginRoute(noteId, revisionId);
    this.currentRequest = request;
    this.permissionSubscription = this.security
      .getPermissions(noteId)
      .pipe(take(1), timeout(READ_TIMEOUT_MS))
      .subscribe({
        next: permissions => this.store.acceptPermissions(request, permissions),
        error: error =>
          this.store.acceptPermissionsFailure(
            request,
            error instanceof HttpErrorResponse && error.status === 403 ? 'accessDenied' : 'failed'
          )
      });
    try {
      const op = revisionId ? OP.NOTE_REVISION : OP.GET_NOTE;
      const data = revisionId ? { noteId, revisionId } : { id: noteId };
      this.message.sendNotebookCoreRead(
        msgId => {
          const timeout = setTimeout(() => {
            this.pending.delete(msgId);
            this.store.acceptNoteFailure(request, 'failed');
          }, READ_TIMEOUT_MS);
          this.pending.set(msgId, { request, timeout });
        },
        op,
        data
      );
    } catch {
      this.clearPending();
      this.store.acceptNoteFailure(request, 'failed');
    }
  }

  invalidate(): void {
    this.clearPending();
    this.clearPendingSaves();
    this.clearPendingRuns();
    this.permissionSubscription?.unsubscribe();
    if (this.currentRequest) {
      this.store.acceptNoteFailure(this.currentRequest, 'failed');
    }
  }

  destroy(): void {
    this.clearPending();
    this.clearPendingSaves();
    this.clearPendingRuns();
    this.permissionSubscription?.unsubscribe();
    this.subscriptions.unsubscribe();
    this.store.dispose();
  }

  private receive(envelope: { op: OP; msgId?: string; data?: unknown }): void {
    if (envelope.msgId && this.message.isNotebookCoreCommitRequestId(envelope.msgId)) {
      this.receiveSaveResponse(envelope);
      return;
    }
    if (
      envelope.msgId &&
      this.message.isNotebookCoreRunRequestId(envelope.msgId) &&
      (envelope.op === OP.PARAGRAPH || envelope.op === OP.ERROR_INFO || envelope.op === OP.AUTH_INFO)
    ) {
      this.receiveRunResponse(envelope);
      return;
    }
    this.receiveParagraphChange(envelope);
    if (!envelope.msgId) {
      return;
    }
    const pending = this.pending.get(envelope.msgId);
    if (!pending) {
      return;
    }
    const { request, timeout } = pending;
    if (envelope.op === OP.NOTE && request.revisionId === null) {
      const note = normalizeReadNote((envelope.data as Note | undefined)?.note);
      if (note && !this.store.acceptNote(request, note)) {
        return;
      }
      this.pending.delete(envelope.msgId);
      clearTimeout(timeout);
      if (!note) {
        this.store.acceptNoteFailure(request, 'failed');
      }
    } else if (envelope.op === OP.NOTE_REVISION && request.revisionId !== null) {
      const revision = envelope.data as NoteRevision | undefined;
      const note = normalizeReadNote(revision?.note);
      if (!revision || !note) {
        this.pending.delete(envelope.msgId);
        clearTimeout(timeout);
        this.store.acceptNoteFailure(request, 'failed');
      } else if (this.store.acceptRevision(request, { ...revision, note })) {
        this.pending.delete(envelope.msgId);
        clearTimeout(timeout);
      }
    } else if (envelope.op === OP.ERROR_INFO || envelope.op === OP.AUTH_INFO) {
      this.pending.delete(envelope.msgId);
      clearTimeout(timeout);
      const error = envelope.data as { errorType?: string } | undefined;
      const status =
        envelope.op === OP.AUTH_INFO || error?.errorType === 'FORBIDDEN'
          ? 'accessDenied'
          : error?.errorType === 'NOTE_NOT_FOUND'
            ? 'notFound'
            : 'failed';
      this.store.acceptNoteFailure(request, status);
    }
  }

  private dispatch(command: NotebookCoreCommand): NotebookCoreCommandResult {
    const request = this.currentRequest;
    if (!request || request.revisionId !== null) {
      return Object.freeze({ accepted: false });
    }
    const state = this.store.getSnapshot().readState;
    if (state.status !== 'ready') {
      return Object.freeze({ accepted: false });
    }
    const result = this.store.dispatch(command);
    if (!result.accepted) {
      return result;
    }
    if (command.type === 'insertParagraph' || command.type === 'moveParagraph' || command.type === 'removeParagraph') {
      try {
        if (command.type === 'insertParagraph') {
          const msgId = this.message.insertParagraph(command.index);
          this.message.consumeLocalAddFocusMsgId(msgId);
        } else if (command.type === 'moveParagraph') {
          this.message.moveParagraph(command.paragraphId, command.index);
        } else {
          this.message.paragraphRemove(command.paragraphId);
        }
        return result;
      } catch {
        return Object.freeze({ accepted: false });
      }
    }
    const paragraph = state.data.paragraphsById[command.paragraphId];
    if (!paragraph) {
      return Object.freeze({ accepted: false });
    }
    if (command.type === 'runParagraph' || command.type === 'cancelParagraph') {
      let registeredMsgId: string | undefined;
      try {
        if (command.type === 'cancelParagraph') {
          this.message.cancelParagraph(command.paragraphId);
        } else {
          const run = result.run;
          if (!run) {
            return Object.freeze({ accepted: false });
          }
          const settings = paragraph.settings as { params?: ParagraphConfig } | undefined;
          this.message.sendNotebookCoreRun(
            msgId => {
              registeredMsgId = msgId;
              const timeout = setTimeout(() => {
                this.pendingRuns.delete(msgId);
                this.store.rejectRun(request, run);
              }, READ_TIMEOUT_MS);
              this.pendingRuns.set(msgId, { request, run, timeout });
            },
            OP.RUN_PARAGRAPH,
            {
              id: run.paragraphId,
              title: typeof paragraph.title === 'string' ? paragraph.title : undefined,
              paragraph: run.text,
              config: (paragraph.config ?? {}) as ParagraphConfig,
              params: settings?.params ?? {},
              ackRequested: true
            }
          );
        }
        return result;
      } catch {
        if (registeredMsgId) {
          const pending = this.pendingRuns.get(registeredMsgId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRuns.delete(registeredMsgId);
          }
        }
        if (result.run) {
          this.store.rejectRun(request, result.run);
        }
        return Object.freeze({ accepted: false });
      }
    }
    if (!result.save) {
      return result;
    }
    const save = result.save;
    const title = typeof paragraph.title === 'string' ? paragraph.title : undefined;
    const config = (paragraph.config ?? {}) as ParagraphConfig;
    const settings = paragraph.settings as { params?: ParagraphConfig } | undefined;
    let registeredMsgId: string | undefined;
    try {
      this.message.sendNotebookCoreCommit(
        msgId => {
          registeredMsgId = msgId;
          const timeout = setTimeout(() => {
            this.pendingSaves.delete(msgId);
            this.store.rejectSave(request, save);
          }, READ_TIMEOUT_MS);
          this.pendingSaves.set(msgId, { request, save, timeout });
        },
        OP.COMMIT_PARAGRAPH,
        {
          id: save.paragraphId,
          noteId: save.noteId,
          title,
          paragraph: save.text,
          config,
          params: settings?.params ?? {}
        }
      );
      return result;
    } catch {
      if (registeredMsgId) {
        const pending = this.pendingSaves.get(registeredMsgId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingSaves.delete(registeredMsgId);
        }
      }
      this.store.rejectSave(request, save);
      return Object.freeze({ accepted: false });
    }
  }

  private receiveSaveResponse(envelope: { op: OP; msgId?: string; data?: unknown }): void {
    const pending = envelope.msgId && this.pendingSaves.get(envelope.msgId);
    if (!pending || !envelope.msgId) {
      return;
    }
    if (envelope.op === OP.PARAGRAPH) {
      const change = envelope.data as { noteId?: unknown; paragraph?: unknown } | undefined;
      const paragraph = normalizeReadParagraph(change?.paragraph);
      if (change?.noteId !== pending.request.noteId || !paragraph || paragraph.id !== pending.save.paragraphId) {
        return;
      }
      this.store.acceptSaveAcknowledgement(pending.request, pending.save, paragraph);
    } else if (envelope.op === OP.ERROR_INFO || envelope.op === OP.AUTH_INFO) {
      this.store.rejectSave(pending.request, pending.save);
    } else {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingSaves.delete(envelope.msgId);
  }

  private receiveRunResponse(envelope: { op: OP; msgId?: string; data?: unknown }): void {
    const pending = envelope.msgId && this.pendingRuns.get(envelope.msgId);
    if (!pending || !envelope.msgId) {
      return;
    }
    if (envelope.op === OP.PARAGRAPH) {
      const change = envelope.data as { noteId?: unknown; paragraph?: unknown } | undefined;
      const paragraph = normalizeReadParagraph(change?.paragraph);
      if (change?.noteId !== pending.request.noteId || !paragraph || paragraph.id !== pending.run.paragraphId) {
        return;
      }
      this.store.acceptRunAcknowledgement(pending.request, pending.run, paragraph);
    } else if (envelope.op === OP.ERROR_INFO || envelope.op === OP.AUTH_INFO) {
      this.store.rejectRun(pending.request, pending.run);
    } else {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRuns.delete(envelope.msgId);
  }

  private receiveParagraphChange(envelope: { op: OP; data?: unknown }): void {
    const request = this.currentRequest;
    const data = envelope.data;
    if (!request || request.revisionId !== null || !data || typeof data !== 'object') {
      return;
    }
    const change = data as Record<string, unknown>;
    // Older servers omit noteId. Do not infer it from the currently open route:
    // a delayed broadcast from a previous visit could otherwise mutate this Core.
    if (change.noteId !== request.noteId) {
      return;
    }
    const sequence = ++this.wireSequence;
    if (
      (envelope.op === OP.PARAGRAPH_APPEND_OUTPUT || envelope.op === OP.PARAGRAPH_UPDATE_OUTPUT) &&
      typeof change.paragraphId === 'string' &&
      Number.isInteger(change.index) &&
      typeof change.data === 'string' &&
      (envelope.op === OP.PARAGRAPH_APPEND_OUTPUT || typeof change.type === 'string')
    ) {
      this.store.acceptOutputEvent(request, {
        noteId: request.noteId,
        paragraphId: change.paragraphId,
        sequence,
        index: change.index as number,
        data: change.data,
        ...(envelope.op === OP.PARAGRAPH_APPEND_OUTPUT
          ? { kind: 'append' as const }
          : { kind: 'update' as const, resultType: change.type as string })
      });
      return;
    }
    const paragraph = normalizeReadParagraph(change.paragraph);
    if (envelope.op === OP.PARAGRAPH_ADDED && Number.isInteger(change.index) && paragraph) {
      this.store.acceptParagraphEvent(request, {
        type: 'insert',
        noteId: request.noteId,
        sequence,
        index: change.index as number,
        paragraph
      });
    } else if (envelope.op === OP.PARAGRAPH && paragraph) {
      this.store.acceptParagraphEvent(request, {
        type: 'update',
        noteId: request.noteId,
        sequence,
        paragraph
      });
    } else if (envelope.op === OP.PARAGRAPH_REMOVED && typeof change.id === 'string') {
      this.store.acceptParagraphEvent(request, {
        type: 'remove',
        noteId: request.noteId,
        sequence,
        paragraphId: change.id
      });
    } else if (envelope.op === OP.PARAGRAPH_MOVED && typeof change.id === 'string' && Number.isInteger(change.index)) {
      this.store.acceptParagraphEvent(request, {
        type: 'move',
        noteId: request.noteId,
        sequence,
        paragraphId: change.id,
        index: change.index as number
      });
    }
  }

  private clearPending(): void {
    for (const { timeout } of this.pending.values()) {
      clearTimeout(timeout);
    }
    this.pending.clear();
  }

  private clearPendingSaves(): void {
    for (const { request, save, timeout } of this.pendingSaves.values()) {
      clearTimeout(timeout);
      this.store.rejectSave(request, save);
    }
    this.pendingSaves.clear();
  }

  private clearPendingRuns(): void {
    for (const { request, run, timeout } of this.pendingRuns.values()) {
      clearTimeout(timeout);
      this.store.rejectRun(request, run);
    }
    this.pendingRuns.clear();
  }
}

const normalizeReadParagraph = (paragraph: unknown): NotebookCoreWireNote['paragraphs'][number] | null => {
  if (!paragraph || typeof paragraph !== 'object') {
    return null;
  }
  const value = paragraph as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    typeof value.status !== 'string' ||
    (value.text != null && typeof value.text !== 'string')
  ) {
    return null;
  }
  return { ...value, id: value.id, status: value.status, text: (value.text as string | null | undefined) ?? '' };
};

const normalizeReadNote = (note: unknown): NotebookCoreWireNote | null => {
  if (!note || typeof note !== 'object') {
    return null;
  }
  const value = note as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.path !== 'string' ||
    !Array.isArray(value.paragraphs)
  ) {
    return null;
  }
  const paragraphs = value.paragraphs.map(normalizeReadParagraph);
  if (paragraphs.some(paragraph => !paragraph)) {
    return null;
  }
  return {
    ...value,
    id: value.id,
    name: value.name,
    path: value.path,
    paragraphs: paragraphs as NotebookCoreWireNote['paragraphs']
  };
};
