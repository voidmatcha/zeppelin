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

import { NotebookCoreReadRequest, NotebookCoreReadStore } from '@zeppelin/notebook-core';
import { Note, NoteRevision, OP } from '@zeppelin/sdk';
import { MessageService, SecurityService } from '@zeppelin/services';

const READ_TIMEOUT_MS = 10000;

/** The Angular host owns transport and the sole Core instance for this route lifetime. */
export class NotebookCoreReadHost {
  readonly store = new NotebookCoreReadStore('');
  readonly port = this.store.port;
  readonly snapshot$ = new Observable<ReturnType<NotebookCoreReadStore['getSnapshot']>>(subscriber => {
    subscriber.next(this.store.getSnapshot());
    return this.store.port.subscribe(() => subscriber.next(this.store.getSnapshot()));
  });

  private readonly subscriptions = new Subscription();
  private permissionSubscription?: Subscription;
  private pending = new Map<string, { request: NotebookCoreReadRequest; timeout: ReturnType<typeof setTimeout> }>();
  private currentRequest?: NotebookCoreReadRequest;

  constructor(
    private readonly message: MessageService,
    private readonly security: SecurityService
  ) {
    // Install the listener before the first read can be sent.
    this.subscriptions.add(this.message.received().subscribe(envelope => this.receive(envelope)));
  }

  load(noteId: string, revisionId: string | null): void {
    this.clearPending();
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
    this.permissionSubscription?.unsubscribe();
    if (this.currentRequest) {
      this.store.acceptNoteFailure(this.currentRequest, 'failed');
    }
  }

  destroy(): void {
    this.clearPending();
    this.permissionSubscription?.unsubscribe();
    this.subscriptions.unsubscribe();
    this.store.dispose();
  }

  private receive(envelope: { op: OP; msgId?: string; data?: unknown }): void {
    if (!envelope.msgId) {
      return;
    }
    const pending = this.pending.get(envelope.msgId);
    if (!pending) {
      return;
    }
    const { request, timeout } = pending;
    if (envelope.op === OP.NOTE && request.revisionId === null) {
      const note = (envelope.data as Note | undefined)?.note;
      if (note && isReadNote(note) && !this.store.acceptNote(request, note)) {
        return;
      }
      this.pending.delete(envelope.msgId);
      clearTimeout(timeout);
      if (!isReadNote(note)) {
        this.store.acceptNoteFailure(request, 'failed');
      }
    } else if (envelope.op === OP.NOTE_REVISION && request.revisionId !== null) {
      const revision = envelope.data as NoteRevision | undefined;
      if (!revision || !isReadNote(revision.note)) {
        this.pending.delete(envelope.msgId);
        clearTimeout(timeout);
        this.store.acceptNoteFailure(request, 'failed');
      } else if (this.store.acceptRevision(request, revision)) {
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

  private clearPending(): void {
    for (const { timeout } of this.pending.values()) {
      clearTimeout(timeout);
    }
    this.pending.clear();
  }
}

const isReadNote = (note: unknown): note is NonNullable<Note['note']> =>
  !!note &&
  typeof note === 'object' &&
  typeof (note as NonNullable<Note['note']>).id === 'string' &&
  Array.isArray((note as NonNullable<Note['note']>).paragraphs);
