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

import { useEffect, useSyncExternalStore } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type { NotebookCorePort, NotebookCoreRemoteProps, NotebookCoreSnapshot } from '@zeppelin/notebook-core';

export type NotebookCorePortProbeProps = NotebookCoreRemoteProps &
  Readonly<{
    expectedCore?: NotebookCorePort;
    onReceivedCore?: (core: NotebookCorePort) => void;
    onProof?: (proof: NotebookCorePortProbeProof) => void;
    onReady?: () => void;
  }>;

export type NotebookCorePortProbeProof = Readonly<{
  sameIdentity: boolean;
  snapshot: NotebookCoreSnapshot;
  updateCount: number;
}>;

export const NotebookCorePortProbe = ({
  core,
  expectedCore,
  onProof,
  onReady,
  onReceivedCore
}: NotebookCorePortProbeProps) => {
  const snapshot = useSyncExternalStore(core.subscribe, core.getSnapshot, core.getSnapshot);
  const updateCount = snapshot.version;
  const sameIdentity = Object.is(core, expectedCore);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    onProof?.({ sameIdentity, snapshot, updateCount });
    onReceivedCore?.(core);
  }, [core, onProof, onReceivedCore, sameIdentity, snapshot, updateCount]);

  return (
    <section
      data-testid="notebook-core-port-probe"
      data-same-identity={sameIdentity ? 'true' : 'false'}
      data-note-id={snapshot.noteId}
      data-revision-id={snapshot.revisionId ?? ''}
      data-phase={snapshot.phase}
      data-title={snapshot.title ?? ''}
      data-paragraph-count={String(snapshot.paragraphs.length)}
      data-version={String(snapshot.version)}
      data-update-count={String(updateCount)}
    >
      <span>{snapshot.noteId}</span>
      <span>{snapshot.revisionId ?? 'live'}</span>
    </section>
  );
};

export interface NotebookCorePortProbeMountHandle {
  update: (props: NotebookCorePortProbeProps) => void;
  unmount: () => void;
}

export const mount = (
  element: HTMLElement,
  initialProps: NotebookCorePortProbeProps
): NotebookCorePortProbeMountHandle => {
  if (!element) {
    throw new Error('Mount element is required');
  }

  const root: Root = createRoot(element);

  const renderWith = (props: NotebookCorePortProbeProps) => {
    root.render(<NotebookCorePortProbe {...props} />);
  };

  renderWith(initialProps);

  return {
    update: (newProps: NotebookCorePortProbeProps) => {
      renderWith(newProps);
    },
    unmount: () => {
      root.unmount();
    }
  };
};
