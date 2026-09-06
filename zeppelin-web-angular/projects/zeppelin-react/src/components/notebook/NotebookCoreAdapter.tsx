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

import type { NotebookCorePort, NotebookCoreRemoteProps } from '@zeppelin/notebook-core';
import { useState, useSyncExternalStore } from 'react';
import { createRoot, Root } from 'react-dom/client';

import { ReactErrorBoundary } from '../paragraph/ReactErrorBoundary';

export type NotebookCoreAdapterProps = NotebookCoreRemoteProps &
  Readonly<{
    expectedCore?: NotebookCorePort;
    onError?: (error: unknown) => void;
  }>;

export const NotebookCoreAdapter = ({
  core,
  expectedCore,
  onParagraphTextChange,
  onParagraphInsert,
  onParagraphRemove,
  onParagraphMove,
  onNotebookTitleChange
}: NotebookCoreAdapterProps) => {
  const snapshot = useSyncExternalStore(core.subscribe, core.getSnapshot, core.getSnapshot);
  const [commandAccepted, setCommandAccepted] = useState<boolean | null>(null);
  const canRun = (paragraph: (typeof snapshot.paragraphs)[number]): boolean =>
    snapshot.phase === 'ready' &&
    snapshot.revisionId === null &&
    Boolean(paragraph.text) &&
    paragraph.status !== 'PENDING' &&
    paragraph.status !== 'RUNNING';

  const dispatch = (type: 'run-paragraph' | 'cancel-paragraph' | 'commit-paragraph', paragraphId: string): void => {
    const accepted = core.dispatch({ type, paragraphId });
    setCommandAccepted(accepted);
  };

  return (
    <section
      aria-label="React Notebook"
      data-testid="notebook-core-react-adapter"
      data-port-shared={expectedCore ? String(core === expectedCore) : 'unknown'}
      data-version={snapshot.version}
      data-note-id={snapshot.noteId}
      data-phase={snapshot.phase}
      data-title={snapshot.title ?? ''}
      data-paragraph-count={snapshot.paragraphs.length}
      data-paragraph-statuses={JSON.stringify(snapshot.paragraphs.map(paragraph => paragraph.status))}
      data-command-accepted={commandAccepted === null ? 'not-dispatched' : String(commandAccepted)}
    >
      <header>
        <input
          aria-label="Notebook title"
          disabled={snapshot.revisionId !== null}
          defaultValue={snapshot.title ?? ''}
          onBlur={event => onNotebookTitleChange?.(event.target.value)}
        />
        <span>{snapshot.paragraphs.length} paragraphs</span>
      </header>
      <ol aria-label="Notebook paragraphs">
        {snapshot.paragraphs.map((paragraph, index) => (
          <li key={paragraph.id} data-testid={`notebook-core-paragraph-${paragraph.id}`}>
            <article aria-label={`Paragraph ${index + 1}`}>
              <header>
                <strong>Paragraph {index + 1}</strong>
                <span>{paragraph.status}</span>
              </header>
              <textarea
                aria-label={`Paragraph ${index + 1} editor`}
                disabled={snapshot.revisionId !== null || paragraph.status === 'RUNNING'}
                value={paragraph.text}
                onChange={event => onParagraphTextChange?.(paragraph.id, event.target.value)}
              />
              <div>
                <button
                  type="button"
                  disabled={snapshot.revisionId !== null}
                  onClick={() => onParagraphInsert?.(index)}
                >
                  Add above
                </button>
                <button
                  type="button"
                  disabled={snapshot.revisionId !== null}
                  onClick={() => onParagraphInsert?.(index + 1)}
                >
                  Add below
                </button>
                <button
                  type="button"
                  disabled={snapshot.revisionId !== null || index === 0}
                  onClick={() => onParagraphMove?.(paragraph.id, index - 1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={snapshot.revisionId !== null || index === snapshot.paragraphs.length - 1}
                  onClick={() => onParagraphMove?.(paragraph.id, index + 1)}
                >
                  Move down
                </button>
                <button
                  type="button"
                  disabled={snapshot.revisionId !== null}
                  onClick={() => onParagraphRemove?.(paragraph.id)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  disabled={snapshot.revisionId !== null || !paragraph.isDirty}
                  onClick={() => dispatch('commit-paragraph', paragraph.id)}
                >
                  Save
                </button>
                <button type="button" disabled={!canRun(paragraph)} onClick={() => dispatch('run-paragraph', paragraph.id)}>
                  Run
                </button>
                <button
                  type="button"
                  disabled={paragraph.status !== 'PENDING' && paragraph.status !== 'RUNNING'}
                  onClick={() => dispatch('cancel-paragraph', paragraph.id)}
                >
                  Cancel
                </button>
              </div>
              {paragraph.results && paragraph.results.length > 0 ? (
                <div data-testid="react-notebook-core-results">
                  {paragraph.results.map((result, resultIndex) => (
                    <pre key={resultIndex} data-testid="react-notebook-core-result">
                      {result.data}
                    </pre>
                  ))}
                </div>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
};

export interface NotebookCoreAdapterMountHandle {
  update: (props: NotebookCoreAdapterProps) => void;
  unmount: () => void;
}

export const mount = (element: HTMLElement, initialProps: NotebookCoreAdapterProps): NotebookCoreAdapterMountHandle => {
  if (!element) {
    throw new Error('Mount element is required');
  }

  const root: Root = createRoot(element);
  const renderWith = (props: NotebookCoreAdapterProps): void => {
    root.render(
      <ReactErrorBoundary onError={props.onError}>
        <NotebookCoreAdapter {...props} />
      </ReactErrorBoundary>
    );
  };

  renderWith(initialProps);

  return {
    update: renderWith,
    unmount: () => root.unmount()
  };
};
