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

import { Injectable } from '@angular/core';
import {
  createNotebookCore,
  selectNotebookParagraphViews,
  type NotebookCoreCommand,
  type NotebookCorePort,
  type NotebookCoreSnapshot,
  type NotebookParagraphStatus
} from '@zeppelin/notebook-core';
import type { Note } from '@zeppelin/sdk';
import { NgZService } from '@zeppelin/services/ng-z.service';
import { diff_match_patch as DiffMatchPatch } from 'diff-match-patch';
import { Observable } from 'rxjs';

type LoadedNote = Exclude<Note['note'], undefined>;
type LoadedParagraph = LoadedNote['paragraphs'][number];

const paragraphStatuses = new Set<NotebookParagraphStatus>([
  'UNKNOWN',
  'READY',
  'PENDING',
  'RUNNING',
  'FINISHED',
  'ERROR',
  'ABORT'
]);

const normalizeParagraphStatus = (status: string): NotebookParagraphStatus => {
  const candidate = status as NotebookParagraphStatus;
  return paragraphStatuses.has(candidate) ? candidate : 'UNKNOWN';
};

const toParagraphSnapshot = (paragraph: LoadedParagraph) => ({
  id: paragraph.id,
  text: paragraph.text ?? '',
  status: normalizeParagraphStatus(paragraph.status)
});

@Injectable()
export class NotebookCoreRouteAdapter {
  readonly port: NotebookCorePort;
  readonly snapshot$: Observable<NotebookCoreSnapshot>;
  private readonly runtime;
  private readonly diffMatchPatch = new DiffMatchPatch();
  private readonly paragraphViewsById = new Map<string, LoadedParagraph>();

  constructor(private readonly ngZService: NgZService) {
    this.runtime = createNotebookCore({ dispatchCommand: command => this.dispatchCommand(command) });
    this.port = this.runtime.port;
    this.snapshot$ = new Observable<NotebookCoreSnapshot>(subscriber => {
      subscriber.next(this.port.getSnapshot());
      return this.port.subscribe(() => subscriber.next(this.port.getSnapshot()));
    });
  }

  enterRoute(noteId: string, revisionId: string | null): void {
    this.runtime.apply({ type: 'route-changed', noteId, revisionId });
    this.runtime.apply({ type: 'load-started' });
  }

  acceptNote(note: LoadedNote, revisionId: string | null): readonly LoadedParagraph[] | null {
    const previousParagraphViews = [...this.paragraphViewsById.values()];
    this.replaceParagraphViews(note.paragraphs);
    const accepted = this.runtime.apply({
      type: 'note-loaded',
      noteId: note.id,
      revisionId,
      title: note.name,
      paragraphs: note.paragraphs.map(toParagraphSnapshot)
    });
    if (!accepted) {
      this.replaceParagraphViews(previousParagraphViews);
      return null;
    }
    return this.selectParagraphViews();
  }

  acceptParagraphAdded(paragraph: LoadedParagraph, index: number): readonly LoadedParagraph[] | null {
    const previousParagraph = this.paragraphViewsById.get(paragraph.id);
    this.paragraphViewsById.set(paragraph.id, paragraph);
    const accepted = this.runtime.apply({ type: 'paragraph-added', paragraph: toParagraphSnapshot(paragraph), index });
    if (!accepted) {
      if (previousParagraph) {
        this.paragraphViewsById.set(paragraph.id, previousParagraph);
      } else {
        this.paragraphViewsById.delete(paragraph.id);
      }
      return null;
    }
    return this.selectParagraphViews();
  }

  acceptParagraphRemoved(paragraphId: string): readonly LoadedParagraph[] | null {
    const previousParagraph = this.paragraphViewsById.get(paragraphId);
    this.paragraphViewsById.delete(paragraphId);
    const accepted = this.runtime.apply({ type: 'paragraph-removed', paragraphId });
    if (!accepted) {
      if (previousParagraph) {
        this.paragraphViewsById.set(paragraphId, previousParagraph);
      }
      return null;
    }
    return this.selectParagraphViews();
  }

  acceptParagraphMoved(paragraphId: string, index: number): readonly LoadedParagraph[] | null {
    if (!this.runtime.apply({ type: 'paragraph-moved', paragraphId, index })) {
      return null;
    }
    return this.selectParagraphViews();
  }

  acceptParagraphUpdated(paragraph: LoadedParagraph): void {
    this.runtime.apply({
      type: 'paragraph-updated',
      paragraphId: paragraph.id,
      text: paragraph.text ?? '',
      status: normalizeParagraphStatus(paragraph.status)
    });
  }

  acceptParagraphText(paragraphId: string, text: string): void {
    this.runtime.apply({ type: 'paragraph-updated', paragraphId, text });
  }

  acceptParagraphPatch(paragraphId: string, patch: string): boolean {
    const paragraph = this.port.getSnapshot().paragraphs.find(candidate => candidate.id === paragraphId);
    if (!paragraph) {
      return false;
    }

    try {
      const [text, applied] = this.diffMatchPatch.patch_apply(
        this.diffMatchPatch.patch_fromText(patch),
        paragraph.text
      );
      if (!applied.every(Boolean)) {
        return false;
      }
      this.runtime.apply({ type: 'paragraph-updated', paragraphId, text });
      return true;
    } catch {
      return false;
    }
  }

  acceptParagraphStatus(paragraphId: string, status: string): void {
    this.runtime.apply({
      type: 'paragraph-updated',
      paragraphId,
      status: normalizeParagraphStatus(status)
    });
  }

  acceptNoteUpdated(title: string): void {
    this.runtime.apply({ type: 'note-updated', title });
  }

  private selectParagraphViews(): readonly LoadedParagraph[] {
    return selectNotebookParagraphViews(this.port.getSnapshot(), this.paragraphViewsById);
  }

  private dispatchCommand(command: NotebookCoreCommand): boolean {
    const snapshot = this.port.getSnapshot();
    if (snapshot.phase !== 'ready' || snapshot.revisionId !== null) {
      return false;
    }

    const coreParagraph = snapshot.paragraphs.find(paragraph => paragraph.id === command.paragraphId);
    if (!coreParagraph?.text || coreParagraph.status === 'PENDING' || coreParagraph.status === 'RUNNING') {
      return false;
    }

    this.ngZService.runParagraph(command.paragraphId);
    return true;
  }

  private replaceParagraphViews(paragraphs: Iterable<LoadedParagraph>): void {
    this.paragraphViewsById.clear();
    for (const paragraph of paragraphs) {
      this.paragraphViewsById.set(paragraph.id, paragraph);
    }
  }
}
