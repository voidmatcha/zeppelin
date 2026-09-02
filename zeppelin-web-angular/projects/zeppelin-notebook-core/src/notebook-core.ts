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
  NotebookCoreCommandHandler,
  NotebookCorePort,
  NotebookCoreSnapshot,
  NotebookCoreSnapshotListener,
  NotebookParagraphSnapshot
} from './host-remote-contract';

export type NotebookCoreEvent =
  | Readonly<{ type: 'route-changed'; noteId: string; revisionId: string | null }>
  | Readonly<{ type: 'load-started' }>
  | Readonly<{
      type: 'note-loaded';
      noteId: string;
      revisionId: string | null;
      title: string;
      paragraphs: readonly NotebookParagraphSnapshot[];
    }>
  | Readonly<{ type: 'paragraph-added'; index: number; paragraph: NotebookParagraphSnapshot }>
  | Readonly<{ type: 'paragraph-removed'; paragraphId: string }>
  | Readonly<{ type: 'paragraph-moved'; paragraphId: string; index: number }>
  | Readonly<{
      type: 'paragraph-updated';
      paragraphId: string;
      text?: string;
      status?: NotebookParagraphSnapshot['status'];
    }>
  | Readonly<{ type: 'note-updated'; title: string }>
  | Readonly<{ type: 'load-failed'; noteId: string; revisionId: string | null; error: string }>;

export type NotebookCoreRuntime = Readonly<{
  port: NotebookCorePort;
  apply: (event: NotebookCoreEvent) => boolean;
}>;

export type NotebookCoreInitialRoute = Readonly<{
  noteId?: string;
  revisionId?: string | null;
  dispatchCommand?: NotebookCoreCommandHandler;
}>;

export const selectNotebookParagraphViews = <T extends Readonly<{ id: string }>>(
  snapshot: NotebookCoreSnapshot,
  paragraphViewsById: ReadonlyMap<string, T>
): readonly T[] =>
  snapshot.paragraphs.map(paragraph => {
    const paragraphView = paragraphViewsById.get(paragraph.id);
    if (!paragraphView) {
      throw new Error(`Missing paragraph view for Core paragraph ${paragraph.id}`);
    }
    return paragraphView;
  });

const freezeParagraphs = (paragraphs: readonly NotebookParagraphSnapshot[]): readonly NotebookParagraphSnapshot[] =>
  Object.freeze(paragraphs.map(paragraph => Object.freeze({ ...paragraph })));

const freezeSnapshot = (snapshot: NotebookCoreSnapshot): NotebookCoreSnapshot =>
  Object.freeze({
    ...snapshot,
    paragraphs: freezeParagraphs(snapshot.paragraphs)
  });

const initialSnapshot = (route: NotebookCoreInitialRoute): NotebookCoreSnapshot =>
  freezeSnapshot({
    version: 0,
    noteId: route.noteId ?? '',
    revisionId: route.revisionId ?? null,
    phase: 'idle',
    title: null,
    paragraphs: [],
    error: null
  });

const clampIndex = (index: number, length: number): number => Math.min(Math.max(index, 0), length);

const hasSameParagraphOrder = (
  left: readonly NotebookParagraphSnapshot[],
  right: readonly NotebookParagraphSnapshot[]
): boolean => left.length === right.length && left.every((paragraph, index) => paragraph.id === right[index]?.id);

const reduceSnapshot = (snapshot: NotebookCoreSnapshot, event: NotebookCoreEvent): NotebookCoreSnapshot => {
  const version = snapshot.version + 1;
  switch (event.type) {
    case 'route-changed':
      return freezeSnapshot({
        version,
        noteId: event.noteId,
        revisionId: event.revisionId,
        phase: 'idle',
        title: null,
        paragraphs: [],
        error: null
      });
    case 'load-started':
      return freezeSnapshot({
        ...snapshot,
        version,
        phase: 'loading',
        title: null,
        paragraphs: [],
        error: null
      });
    case 'note-loaded':
      if (event.noteId !== snapshot.noteId || event.revisionId !== snapshot.revisionId) {
        return snapshot;
      }
      return freezeSnapshot({
        ...snapshot,
        version,
        phase: 'ready',
        title: event.title,
        paragraphs: event.paragraphs,
        error: null
      });
    case 'paragraph-added': {
      if (snapshot.phase !== 'ready' || snapshot.paragraphs.some(paragraph => paragraph.id === event.paragraph.id)) {
        return snapshot;
      }
      const index = clampIndex(event.index, snapshot.paragraphs.length);
      const paragraphs = [...snapshot.paragraphs.slice(0, index), event.paragraph, ...snapshot.paragraphs.slice(index)];
      return freezeSnapshot({ ...snapshot, version, paragraphs });
    }
    case 'paragraph-removed': {
      if (snapshot.phase !== 'ready') {
        return snapshot;
      }
      const paragraphs = snapshot.paragraphs.filter(paragraph => paragraph.id !== event.paragraphId);
      if (paragraphs.length === snapshot.paragraphs.length) {
        return snapshot;
      }
      return freezeSnapshot({ ...snapshot, version, paragraphs });
    }
    case 'paragraph-moved': {
      if (snapshot.phase !== 'ready') {
        return snapshot;
      }
      const paragraph = snapshot.paragraphs.find(candidate => candidate.id === event.paragraphId);
      if (!paragraph) {
        return snapshot;
      }
      const remaining = snapshot.paragraphs.filter(candidate => candidate.id !== event.paragraphId);
      const index = clampIndex(event.index, remaining.length);
      const paragraphs = [...remaining.slice(0, index), paragraph, ...remaining.slice(index)];
      if (hasSameParagraphOrder(snapshot.paragraphs, paragraphs)) {
        return snapshot;
      }
      return freezeSnapshot({ ...snapshot, version, paragraphs });
    }
    case 'paragraph-updated': {
      if (snapshot.phase !== 'ready') {
        return snapshot;
      }
      const index = snapshot.paragraphs.findIndex(paragraph => paragraph.id === event.paragraphId);
      if (index < 0) {
        return snapshot;
      }
      const current = snapshot.paragraphs[index];
      const paragraph = {
        ...current,
        text: event.text ?? current.text,
        status: event.status ?? current.status
      };
      if (paragraph.text === current.text && paragraph.status === current.status) {
        return snapshot;
      }
      const paragraphs = [...snapshot.paragraphs];
      paragraphs[index] = paragraph;
      return freezeSnapshot({ ...snapshot, version, paragraphs });
    }
    case 'note-updated':
      if (snapshot.phase !== 'ready' || snapshot.title === event.title) {
        return snapshot;
      }
      return freezeSnapshot({ ...snapshot, version, title: event.title });
    case 'load-failed':
      if (event.noteId !== snapshot.noteId || event.revisionId !== snapshot.revisionId) {
        return snapshot;
      }
      return freezeSnapshot({
        ...snapshot,
        version,
        phase: 'error',
        title: null,
        paragraphs: [],
        error: event.error
      });
  }
};

export const createNotebookCore = (route: NotebookCoreInitialRoute = {}): NotebookCoreRuntime => {
  let snapshot = initialSnapshot(route);
  const listeners = new Set<NotebookCoreSnapshotListener>();
  const port: NotebookCorePort = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: command => route.dispatchCommand?.(command) ?? false
  });

  return Object.freeze({
    port,
    apply: (event: NotebookCoreEvent) => {
      const nextSnapshot = reduceSnapshot(snapshot, event);
      if (nextSnapshot === snapshot) {
        return false;
      }
      snapshot = nextSnapshot;
      listeners.forEach(listener => listener());
      return true;
    }
  });
};
