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

type NotebookCoreState = Readonly<{
  version: number;
  noteId: string;
  revisionId: string | null;
  phase: NotebookCoreSnapshot['phase'];
  title: string | null;
  paragraphOrder: readonly string[];
  paragraphsById: Readonly<Record<string, NotebookParagraphSnapshot>>;
  error: string | null;
}>;

const freezeParagraph = (paragraph: NotebookParagraphSnapshot): NotebookParagraphSnapshot =>
  Object.freeze({ ...paragraph });

const freezeState = (state: NotebookCoreState): NotebookCoreState =>
  Object.freeze({
    ...state,
    paragraphOrder: Object.freeze([...state.paragraphOrder]),
    paragraphsById: Object.freeze({ ...state.paragraphsById })
  });

const toSnapshot = (state: NotebookCoreState): NotebookCoreSnapshot =>
  Object.freeze({
    version: state.version,
    noteId: state.noteId,
    revisionId: state.revisionId,
    phase: state.phase,
    title: state.title,
    paragraphs: Object.freeze(state.paragraphOrder.map(paragraphId => state.paragraphsById[paragraphId])),
    error: state.error
  });

const emptyParagraphState = (): Pick<NotebookCoreState, 'paragraphOrder' | 'paragraphsById'> => ({
  paragraphOrder: [],
  paragraphsById: {}
});

const toParagraphState = (
  paragraphs: readonly NotebookParagraphSnapshot[]
): Pick<NotebookCoreState, 'paragraphOrder' | 'paragraphsById'> => {
  const paragraphsById: Record<string, NotebookParagraphSnapshot> = {};
  const paragraphOrder: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraphsById[paragraph.id]) {
      continue;
    }
    paragraphsById[paragraph.id] = freezeParagraph(paragraph);
    paragraphOrder.push(paragraph.id);
  }
  return { paragraphOrder, paragraphsById };
};

const initialState = (route: NotebookCoreInitialRoute): NotebookCoreState =>
  freezeState({
    version: 0,
    noteId: route.noteId ?? '',
    revisionId: route.revisionId ?? null,
    phase: 'idle',
    title: null,
    ...emptyParagraphState(),
    error: null
  });

const clampIndex = (index: number, length: number): number => Math.min(Math.max(index, 0), length);

const hasSameParagraphOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((paragraphId, index) => paragraphId === right[index]);

const isLiveMutation = (event: NotebookCoreEvent): boolean =>
  event.type === 'paragraph-added' ||
  event.type === 'paragraph-removed' ||
  event.type === 'paragraph-moved' ||
  event.type === 'paragraph-updated' ||
  event.type === 'note-updated';

const reduceState = (state: NotebookCoreState, event: NotebookCoreEvent): NotebookCoreState => {
  const version = state.version + 1;
  if (state.revisionId !== null && isLiveMutation(event)) {
    return state;
  }
  switch (event.type) {
    case 'route-changed':
      return freezeState({
        version,
        noteId: event.noteId,
        revisionId: event.revisionId,
        phase: 'idle',
        title: null,
        ...emptyParagraphState(),
        error: null
      });
    case 'load-started':
      return freezeState({
        ...state,
        version,
        phase: 'loading',
        title: null,
        ...emptyParagraphState(),
        error: null
      });
    case 'note-loaded':
      if (event.noteId !== state.noteId || event.revisionId !== state.revisionId) {
        return state;
      }
      return freezeState({
        ...state,
        version,
        phase: 'ready',
        title: event.title,
        ...toParagraphState(event.paragraphs),
        error: null
      });
    case 'paragraph-added': {
      if (state.phase !== 'ready' || state.paragraphsById[event.paragraph.id]) {
        return state;
      }
      const index = clampIndex(event.index, state.paragraphOrder.length);
      const paragraphOrder = [
        ...state.paragraphOrder.slice(0, index),
        event.paragraph.id,
        ...state.paragraphOrder.slice(index)
      ];
      return freezeState({
        ...state,
        version,
        paragraphOrder,
        paragraphsById: { ...state.paragraphsById, [event.paragraph.id]: freezeParagraph(event.paragraph) }
      });
    }
    case 'paragraph-removed': {
      if (state.phase !== 'ready' || !state.paragraphsById[event.paragraphId]) {
        return state;
      }
      const { [event.paragraphId]: _, ...paragraphsById } = state.paragraphsById;
      return freezeState({
        ...state,
        version,
        paragraphOrder: state.paragraphOrder.filter(paragraphId => paragraphId !== event.paragraphId),
        paragraphsById
      });
    }
    case 'paragraph-moved': {
      if (state.phase !== 'ready' || !state.paragraphsById[event.paragraphId]) {
        return state;
      }
      const remaining = state.paragraphOrder.filter(paragraphId => paragraphId !== event.paragraphId);
      const index = clampIndex(event.index, remaining.length);
      const paragraphOrder = [...remaining.slice(0, index), event.paragraphId, ...remaining.slice(index)];
      if (hasSameParagraphOrder(state.paragraphOrder, paragraphOrder)) {
        return state;
      }
      return freezeState({ ...state, version, paragraphOrder });
    }
    case 'paragraph-updated': {
      if (state.phase !== 'ready') {
        return state;
      }
      const current = state.paragraphsById[event.paragraphId];
      if (!current) {
        return state;
      }
      const paragraph = {
        ...current,
        text: event.text ?? current.text,
        status: event.status ?? current.status
      };
      if (paragraph.text === current.text && paragraph.status === current.status) {
        return state;
      }
      return freezeState({
        ...state,
        version,
        paragraphsById: { ...state.paragraphsById, [event.paragraphId]: freezeParagraph(paragraph) }
      });
    }
    case 'note-updated':
      if (state.phase !== 'ready' || state.title === event.title) {
        return state;
      }
      return freezeState({ ...state, version, title: event.title });
    case 'load-failed':
      if (event.noteId !== state.noteId || event.revisionId !== state.revisionId) {
        return state;
      }
      return freezeState({
        ...state,
        version,
        phase: 'error',
        title: null,
        ...emptyParagraphState(),
        error: event.error
      });
  }
};

export const createNotebookCore = (route: NotebookCoreInitialRoute = {}): NotebookCoreRuntime => {
  let state = initialState(route);
  let snapshot = toSnapshot(state);
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
      const nextState = reduceState(state, event);
      if (nextState === state) {
        return false;
      }
      state = nextState;
      snapshot = toSnapshot(state);
      listeners.forEach(listener => listener());
      return true;
    }
  });
};
