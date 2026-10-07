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

import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { NotebookCoreRemoteProps } from '@zeppelin/notebook-core';
import { ReactErrorBoundary } from '@/components';
import { NotebookCoreProvider, useNotebookSelector } from '@/notebook/NotebookCoreProvider';

export type NotebookRouteEntryProps = NotebookCoreRemoteProps & {
  onError?: (error: unknown) => void;
  onReady?: () => void;
};

/** Mount confirmation is not read-only screen readiness; ZEPPELIN-6729 supplies that screen. */
export const NotebookRouteEntry = ({ onReady }: { onReady?: () => void }) => {
  const status = useNotebookSelector(snapshot => snapshot.readState?.status ?? 'initial');
  useEffect(() => onReady?.(), [onReady]);
  return (
    <section data-testid="react-notebook-entry" aria-label="React read-only notebook entry">
      <p role="status">Read-only notebook entry: {status}</p>
    </section>
  );
};

export const mount = (element: HTMLElement, initialProps: NotebookRouteEntryProps) => {
  if (!element) {
    throw new Error('Mount element is required');
  }
  const root = createRoot(element);
  const renderWith = (props: NotebookRouteEntryProps) => {
    root.render(
      <ReactErrorBoundary onError={props.onError}>
        <NotebookCoreProvider core={props.core}>
          <NotebookRouteEntry onReady={props.onReady} />
        </NotebookCoreProvider>
      </ReactErrorBoundary>
    );
  };
  renderWith(initialProps);
  return {
    update: renderWith,
    unmount: () => root.unmount()
  };
};
