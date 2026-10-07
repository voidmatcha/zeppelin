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
import { Alert, Tag, Typography } from 'antd';
import type { NotebookCoreReadState, NotebookCoreRemoteProps } from '@zeppelin/notebook-core';
import type { ParagraphConfigResults, ParagraphIResultsMsgItem } from '@zeppelin/sdk';
import { ReactErrorBoundary } from '@/components';
import { NotebookCoreProvider, useNotebookSelector } from '@/notebook/NotebookCoreProvider';
import { SingleResultRenderer } from '@/templates';
import { ZeppelinThemeProvider } from '@/theme';
import './NotebookRouteEntry.css';

export type NotebookRouteEntryProps = NotebookCoreRemoteProps & {
  onError?: (error: unknown) => void;
  onReady?: () => void;
};

type ReadParagraph = Readonly<{
  id: string;
  text: string;
  status: string;
  title?: string;
  config?: {
    editorHide?: boolean;
    tableHide?: boolean;
    results?: ParagraphConfigResults;
  };
  results?: { msg?: ParagraphIResultsMsgItem[] };
}>;

const ReadOnlyParagraph = ({ paragraph, index }: { paragraph: ReadParagraph; index: number }) => (
  <article id={paragraph.id} className="notebook-react-read-paragraph" data-testid="react-notebook-paragraph">
    <header className="notebook-react-read-paragraph-header">
      <Typography.Title level={2}>{paragraph.title || `Paragraph ${index + 1}`}</Typography.Title>
      <Tag>{paragraph.status}</Tag>
    </header>
    {!paragraph.config?.editorHide && <pre className="notebook-react-read-source">{paragraph.text}</pre>}
    {!paragraph.config?.tableHide &&
      paragraph.results?.msg?.map((result, resultIndex) => (
        <div key={resultIndex} className="notebook-react-read-result">
          <SingleResultRenderer result={result} index={resultIndex} config={paragraph.config?.results} readOnly />
        </div>
      ))}
  </article>
);

const NotebookReadContent = ({ state, revisionId }: { state: NotebookCoreReadState; revisionId: string | null }) => {
  if (state.status === 'initial' || state.status === 'loading') {
    return <p role="status">Loading notebook…</p>;
  }
  if (state.status === 'notFound') {
    return <Alert type="error" role="alert" message="Notebook not found." />;
  }
  if (state.status === 'accessDenied') {
    return <Alert type="error" role="alert" message="You do not have access to this notebook." />;
  }
  if (state.status !== 'ready') {
    return <Alert type="error" role="alert" message="Could not load the notebook." />;
  }

  const { note, paragraphOrder, paragraphsById } = state.data;
  return (
    <>
      <header className="notebook-react-read-header">
        <div>
          <p className="notebook-react-read-label">Read-only notebook</p>
          <Typography.Title level={1}>{note.name}</Typography.Title>
          {typeof note.path === 'string' && <p>{note.path}</p>}
          {revisionId && <p>Revision: {revisionId}</p>}
        </div>
      </header>
      {state.acl.status === 'ready' && (
        <section aria-label="Notebook permissions" className="notebook-react-read-permissions">
          <Typography.Title level={2}>Permissions</Typography.Title>
          <p>Owners: {state.acl.permissions.owners.join(', ') || 'None'}</p>
          <p>Readers: {state.acl.permissions.readers.join(', ') || 'None'}</p>
          <p>Writers: {state.acl.permissions.writers.join(', ') || 'None'}</p>
          <p>Runners: {state.acl.permissions.runners.join(', ') || 'None'}</p>
        </section>
      )}
      {state.acl.status === 'loading' && <p role="status">Loading permissions…</p>}
      {state.acl.status === 'failed' && <Alert type="warning" role="alert" message="Could not load permissions." />}
      {state.acl.status === 'accessDenied' && <Alert type="warning" role="alert" message="Permissions are unavailable." />}
      {paragraphOrder.map((id, index) => {
        const paragraph = paragraphsById[id] as ReadParagraph | undefined;
        return paragraph ? <ReadOnlyParagraph key={id} paragraph={paragraph} index={index} /> : null;
      })}
    </>
  );
};

export const NotebookRouteEntry = ({ onReady }: { onReady?: () => void }) => {
  const snapshot = useNotebookSelector(value => value);
  useEffect(() => onReady?.(), [onReady]);
  return (
    <ZeppelinThemeProvider>
      <main data-testid="react-notebook-entry" aria-label="Read-only notebook" className="notebook-react-read">
        <NotebookReadContent
          state={snapshot.readState ?? { status: 'initial', acl: { status: 'loading' } }}
          revisionId={snapshot.revisionId}
        />
      </main>
    </ZeppelinThemeProvider>
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
