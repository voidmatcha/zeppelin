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

export const NotebookCoreAdapter = ({ core, expectedCore }: NotebookCoreAdapterProps) => {
  const snapshot = useSyncExternalStore(core.subscribe, core.getSnapshot, core.getSnapshot);
  const [commandAccepted, setCommandAccepted] = useState<boolean | null>(null);
  const firstParagraph = snapshot.paragraphs[0];
  const canRun =
    snapshot.phase === 'ready' &&
    snapshot.revisionId === null &&
    Boolean(firstParagraph?.text) &&
    firstParagraph?.status !== 'PENDING' &&
    firstParagraph?.status !== 'RUNNING';

  const runFirstParagraph = (): void => {
    const accepted = firstParagraph ? core.dispatch({ type: 'run-paragraph', paragraphId: firstParagraph.id }) : false;
    setCommandAccepted(accepted);
  };

  return (
    <section
      aria-label="React Notebook Core proof"
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
      <strong>{snapshot.title ?? 'Loading notebook'}</strong>
      <span>{snapshot.paragraphs.length} paragraphs</span>
      <button type="button" disabled={!canRun} onClick={runFirstParagraph}>
        Run first paragraph from React
      </button>
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
