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
  type NotebookDynamicForms,
  type NotebookFormParams,
  type NotebookParagraphStatus,
  type NotebookPermissions,
  type NotebookSchedule
} from '@zeppelin/notebook-core';
import type { Note, ParagraphConfigResult } from '@zeppelin/sdk';
import { MessageService } from '@zeppelin/services';
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

const editorLanguage = (paragraph: LoadedParagraph): string | undefined => {
  const configuredLanguage = paragraph.config?.editorSetting?.language;
  if (configuredLanguage) {
    return configuredLanguage;
  }
  const directive = paragraph.text?.replace(/^\s+/, '').match(/^%(\w+)/)?.[1];
  return directive === 'md' ? 'markdown' : directive;
};

const toParagraphSnapshot = (paragraph: LoadedParagraph) => ({
  id: paragraph.id,
  text: paragraph.text ?? '',
  status: normalizeParagraphStatus(paragraph.status),
  language: editorLanguage(paragraph),
  progress: 0,
  results: paragraph.results?.msg?.map(result => ({ type: result.type, data: result.data })),
  resultConfigs: paragraph.config?.results
});

const toNotebookSchedule = (note: LoadedNote): NotebookSchedule | undefined =>
  note.config?.isZeppelinNotebookCronEnable
    ? {
        cron: note.config?.cron,
        releaseResource: Boolean(note.config?.releaseresource)
      }
    : undefined;

@Injectable()
export class NotebookCoreRouteAdapter {
  readonly port: NotebookCorePort;
  readonly snapshot$: Observable<NotebookCoreSnapshot>;
  private readonly runtime;
  private readonly diffMatchPatch = new DiffMatchPatch();
  private readonly paragraphViewsById = new Map<string, LoadedParagraph>();

  constructor(private readonly messageService: MessageService) {
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
      noteForms: note.noteForms as NotebookDynamicForms | undefined,
      noteParams: note.noteParams as NotebookFormParams | undefined,
      scheduler: toNotebookSchedule(note),
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
      status: normalizeParagraphStatus(paragraph.status),
      language: editorLanguage(paragraph),
      resultConfigs: paragraph.config?.results,
      source: 'server'
    });
  }

  acceptParagraphText(paragraphId: string, text: string): void {
    this.runtime.apply({ type: 'paragraph-updated', paragraphId, text, source: 'local' });
  }

  updateParagraphText(paragraphId: string, text: string): boolean {
    const paragraph = this.port.getSnapshot().paragraphs.find(candidate => candidate.id === paragraphId);
    if (!paragraph) {
      return false;
    }
    if (paragraph.text === text) {
      return true;
    }
    const patch = this.diffMatchPatch.patch_toText(this.diffMatchPatch.patch_make(paragraph.text, text));
    this.acceptParagraphText(paragraphId, text);
    return this.sendParagraphPatch(paragraphId, patch);
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
      this.runtime.apply({ type: 'paragraph-updated', paragraphId, text, source: 'server' });
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

  acceptParagraphProgress(paragraphId: string, progress: number): void {
    this.runtime.apply({ type: 'paragraph-progressed', paragraphId, progress });
  }

  acceptParagraphOutputUpdate(paragraphId: string, index: number, type: string, data: string): void {
    this.runtime.apply({ type: 'paragraph-output-updated', paragraphId, index, result: { type, data } });
  }

  acceptParagraphOutputAppend(paragraphId: string, index: number, data: string): void {
    this.runtime.apply({ type: 'paragraph-output-appended', paragraphId, index, data });
  }

  acceptNoteUpdated(title: string): void {
    this.runtime.apply({ type: 'note-updated', title });
  }

  acceptNoteForms(noteForms: NotebookDynamicForms, noteParams: NotebookFormParams): void {
    this.runtime.apply({ type: 'note-forms-updated', noteForms, noteParams });
  }

  acceptPermissions(permissions: NotebookPermissions): void {
    this.runtime.apply({ type: 'permissions-updated', permissions });
  }

  acceptCollaborativeModeStatus(users: readonly string[] | null): void {
    this.runtime.apply({ type: 'collaboration-updated', users });
  }

  acceptSchedule(schedule: NotebookSchedule | null): void {
    this.runtime.apply({ type: 'schedule-updated', scheduler: schedule });
  }

  updateParagraphResultConfig(paragraphId: string, resultIndex: number, resultConfig: ParagraphConfigResult): boolean {
    const paragraph = this.paragraphViewsById.get(paragraphId);
    const coreParagraph = this.port.getSnapshot().paragraphs.find(candidate => candidate.id === paragraphId);
    if (!paragraph || !coreParagraph || this.port.getSnapshot().revisionId !== null) {
      return false;
    }
    const config = { ...paragraph.config, results: { ...paragraph.config.results, [resultIndex]: resultConfig } };
    const updatedParagraph = { ...paragraph, config };
    this.paragraphViewsById.set(paragraphId, updatedParagraph);
    this.acceptParagraphUpdated(updatedParagraph);
    this.messageService.commitParagraph(
      paragraph.id,
      paragraph.title,
      coreParagraph.text,
      config,
      paragraph.settings.params,
      this.port.getSnapshot().noteId
    );
    return true;
  }

  private selectParagraphViews(): readonly LoadedParagraph[] {
    return selectNotebookParagraphViews(this.port.getSnapshot(), this.paragraphViewsById);
  }

  private dispatchCommand(command: NotebookCoreCommand): boolean {
    const snapshot = this.port.getSnapshot();
    if (snapshot.phase !== 'ready' || snapshot.revisionId !== null) {
      return false;
    }

    if (command.type === 'run-all-paragraphs') {
      if (snapshot.paragraphs.some(paragraph => paragraph.status === 'PENDING' || paragraph.status === 'RUNNING')) {
        return false;
      }
      const paragraphs = this.selectParagraphViews();
      if (paragraphs.length !== snapshot.paragraphs.length) {
        return false;
      }
      this.messageService.runAllParagraphs(
        snapshot.noteId,
        paragraphs.map(paragraph => {
          const coreParagraph = snapshot.paragraphs.find(candidate => candidate.id === paragraph.id)!;
          return {
            id: paragraph.id,
            title: paragraph.title,
            paragraph: coreParagraph.text,
            config: paragraph.config,
            params: paragraph.settings.params
          };
        })
      );
      return true;
    }

    if (command.type === 'cancel-all-paragraphs') {
      if (!snapshot.paragraphs.some(paragraph => paragraph.status === 'PENDING' || paragraph.status === 'RUNNING')) {
        return false;
      }
      this.messageService.cancelAllParagraphs(snapshot.noteId);
      return true;
    }

    if (command.type === 'clear-all-paragraph-output') {
      this.messageService.paragraphClearAllOutput(snapshot.noteId);
      return true;
    }

    const coreParagraph = snapshot.paragraphs.find(paragraph => paragraph.id === command.paragraphId);
    if (!coreParagraph) {
      return false;
    }

    if (command.type === 'run-paragraph') {
      if (!coreParagraph.text || coreParagraph.status === 'RUNNING') {
        return false;
      }
      const paragraph = this.paragraphViewsById.get(command.paragraphId);
      if (!paragraph) {
        return false;
      }
      this.messageService.runParagraph(
        paragraph.id,
        paragraph.title,
        coreParagraph.text,
        paragraph.config,
        paragraph.settings.params
      );
      return true;
    }

    if (command.type === 'cancel-paragraph') {
      this.messageService.cancelParagraph(command.paragraphId);
      return true;
    }

    if (command.type === 'patch-paragraph') {
      this.messageService.patchParagraph(command.paragraphId, snapshot.noteId, command.patch);
      return true;
    }

    if (!coreParagraph.isDirty) {
      return false;
    }
    const paragraph = this.paragraphViewsById.get(command.paragraphId);
    if (!paragraph) {
      return false;
    }
    this.messageService.commitParagraph(
      paragraph.id,
      paragraph.title,
      coreParagraph.text,
      paragraph.config,
      paragraph.settings.params,
      snapshot.noteId
    );
    return true;
  }

  sendParagraphPatch(paragraphId: string, patch: string): boolean {
    return this.port.dispatch({ type: 'patch-paragraph', paragraphId, patch });
  }

  private replaceParagraphViews(paragraphs: Iterable<LoadedParagraph>): void {
    this.paragraphViewsById.clear();
    for (const paragraph of paragraphs) {
      this.paragraphViewsById.set(paragraph.id, paragraph);
    }
  }
}
