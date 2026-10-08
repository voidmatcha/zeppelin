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

import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Tag, Typography } from 'antd';
import type {
  NotebookCoreCommandPort,
  NotebookCoreReadState,
  NotebookCoreRemoteProps,
  NotebookCoreSnapshot
} from '@zeppelin/notebook-core';
import { ReactErrorBoundary } from '@/components';
import type { ResultConfigs, ResultMessage } from '@/components/visualizations/result-types';
import { supportsReadOnlyChart } from '@/components/visualizations/readOnlyChartData';
import { NotebookCoreProvider, useNotebookSelector } from '@/notebook/NotebookCoreProvider';
import { SingleResultRenderer } from '@/templates';
import { ZeppelinThemeProvider } from '@/theme';
import './NotebookRouteEntry.css';

export type NotebookRouteEntryProps = NotebookCoreRemoteProps & {
  commandPort?: NotebookCoreCommandPort;
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
    results?: ResultConfigs;
  };
  results?: { msg?: ResultMessage[] };
}>;

const ReadOnlyParagraph = ({
  paragraph,
  draft,
  index,
  paragraphCount,
  commandPort,
  collaborationBlocked,
  onResultReady,
  onError
}: {
  paragraph: ReadParagraph;
  draft?: string;
  index: number;
  paragraphCount: number;
  commandPort?: NotebookCoreCommandPort;
  collaborationBlocked: boolean;
  onResultReady: (key: string) => void;
  onError?: (error: unknown) => void;
}) => (
  <article id={paragraph.id} className="notebook-react-read-paragraph" data-testid="react-notebook-paragraph">
    <header className="notebook-react-read-paragraph-header">
      <Typography.Title level={2}>{paragraph.title || `Paragraph ${index + 1}`}</Typography.Title>
      <Tag>{paragraph.status}</Tag>
    </header>
    {commandPort ? (
      <div className="notebook-react-edit-source">
        <label htmlFor={`react-core-editor-${paragraph.id}`}>Paragraph source</label>
        <textarea
          id={`react-core-editor-${paragraph.id}`}
          value={draft ?? paragraph.text}
          readOnly={collaborationBlocked}
          onChange={event =>
            commandPort.dispatch({ type: 'editParagraph', paragraphId: paragraph.id, text: event.target.value })
          }
        />
        <button
          type="button"
          disabled={collaborationBlocked}
          onClick={() => commandPort.dispatch({ type: 'saveParagraph', paragraphId: paragraph.id })}
        >
          Save paragraph
        </button>
        {paragraph.status === 'PENDING' || paragraph.status === 'RUNNING' ? (
          <button
            type="button"
            disabled={collaborationBlocked}
            onClick={() => commandPort.dispatch({ type: 'cancelParagraph', paragraphId: paragraph.id })}
          >
            Cancel paragraph
          </button>
        ) : (
          <button
            type="button"
            disabled={collaborationBlocked}
            onClick={() => commandPort.dispatch({ type: 'runParagraph', paragraphId: paragraph.id })}
          >
            Run paragraph
          </button>
        )}
        <button
          type="button"
          disabled={collaborationBlocked}
          onClick={() => commandPort.dispatch({ type: 'insertParagraph', index: index + 1 })}
        >
          Add paragraph below
        </button>
        <button
          type="button"
          disabled={collaborationBlocked || index === 0}
          onClick={() => commandPort.dispatch({ type: 'moveParagraph', paragraphId: paragraph.id, index: index - 1 })}
        >
          Move up
        </button>
        <button
          type="button"
          disabled={collaborationBlocked || index === paragraphCount - 1}
          onClick={() => commandPort.dispatch({ type: 'moveParagraph', paragraphId: paragraph.id, index: index + 1 })}
        >
          Move down
        </button>
        <button
          type="button"
          disabled={collaborationBlocked || paragraphCount === 1}
          onClick={() => {
            if (window.confirm('Remove this paragraph?')) {
              commandPort.dispatch({ type: 'removeParagraph', paragraphId: paragraph.id });
            }
          }}
        >
          Remove paragraph
        </button>
      </div>
    ) : (
      !paragraph.config?.editorHide && <pre className="notebook-react-read-source">{paragraph.text}</pre>
    )}
    {!paragraph.config?.tableHide &&
      paragraph.results?.msg?.map((result, resultIndex) => (
        <div key={resultIndex} className="notebook-react-read-result">
          <SingleResultRenderer
            result={result}
            index={resultIndex}
            config={paragraph.config?.results}
            readOnly
            visualKey={`${paragraph.id}:${resultIndex}`}
            onVisualReady={result.type === 'TABLE' ? onResultReady : undefined}
            onVisualError={onError}
          />
        </div>
      ))}
  </article>
);

const NotebookReadContent = ({
  state,
  revisionId,
  draftsById,
  commandPort,
  collaborationBlocked,
  defaultNotebookHref,
  onResultReady,
  onError
}: {
  state: NotebookCoreReadState;
  revisionId: string | null;
  draftsById?: NotebookCoreSnapshot['draftsById'];
  commandPort?: NotebookCoreCommandPort;
  collaborationBlocked: boolean;
  defaultNotebookHref: string;
  onResultReady: (key: string) => void;
  onError?: (error: unknown) => void;
}) => {
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
          <p className="notebook-react-read-label">{commandPort ? 'Private editor preview' : 'Read-only notebook'}</p>
          <Typography.Title level={1}>{note.name}</Typography.Title>
          {typeof note.path === 'string' && <p>{note.path}</p>}
          {revisionId && <p>Revision: {revisionId}</p>}
        </div>
      </header>
      {commandPort && collaborationBlocked && (
        <Alert
          type="warning"
          role="alert"
          message="Editing is paused because this note is in collaborative mode."
          description={<a href={defaultNotebookHref}>Open the standard notebook to edit</a>}
        />
      )}
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
      {state.acl.status === 'accessDenied' && (
        <Alert type="warning" role="alert" message="Permissions are unavailable." />
      )}
      {commandPort && !revisionId && paragraphOrder.length === 0 && (
        <button
          type="button"
          disabled={collaborationBlocked}
          onClick={() => commandPort.dispatch({ type: 'insertParagraph', index: 0 })}
        >
          Add paragraph
        </button>
      )}
      {paragraphOrder.map((id, index) => {
        const paragraph = paragraphsById[id] as ReadParagraph | undefined;
        return paragraph ? (
          <ReadOnlyParagraph
            key={id}
            paragraph={paragraph}
            draft={draftsById?.[id]?.text}
            index={index}
            paragraphCount={paragraphOrder.length}
            commandPort={revisionId ? undefined : commandPort}
            collaborationBlocked={collaborationBlocked}
            onResultReady={onResultReady}
            onError={onError}
          />
        ) : null;
      })}
    </>
  );
};

const NotebookRouteScreen = ({
  snapshot,
  commandPort,
  onReady,
  onError
}: {
  snapshot: NotebookCoreSnapshot;
  commandPort?: NotebookCoreCommandPort;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}) => {
  const reportedReady = useRef(false);
  const [readyResults, setReadyResults] = useState<ReadonlySet<string>>(() => new Set());
  const onResultReady = useCallback((key: string) => {
    setReadyResults(current => (current.has(key) ? current : new Set(current).add(key)));
  }, []);
  const state = snapshot.readState ?? { status: 'initial' as const, acl: { status: 'loading' as const } };
  const activeCommandPort = snapshot.revisionId === null ? commandPort : undefined;
  useEffect(() => {
    if (state.status !== 'ready') {
      reportedReady.current = false;
      setReadyResults(current => (current.size === 0 ? current : new Set()));
    }
  }, [state.status]);
  const requiredResults: string[] = [];
  let hasUnsupportedResult = false;
  if (state.status === 'ready') {
    for (const id of state.data.paragraphOrder) {
      const paragraph = state.data.paragraphsById[id] as ReadParagraph | undefined;
      if (paragraph?.config?.tableHide) continue;
      paragraph?.results?.msg?.forEach((result, index) => {
        if (result.type === 'ANGULAR') {
          hasUnsupportedResult = true;
        } else if (result.type === 'TABLE') {
          if (!supportsReadOnlyChart(paragraph.config?.results?.[index]?.graph)) hasUnsupportedResult = true;
          requiredResults.push(`${id}:${index}`);
        }
      });
    }
  }
  const complete =
    state.status === 'ready' &&
    state.acl.status === 'ready' &&
    !hasUnsupportedResult &&
    requiredResults.every(key => readyResults.has(key));
  useEffect(() => {
    if (onReady && !reportedReady.current && complete) {
      reportedReady.current = true;
      onReady();
    }
  }, [complete, onReady]);
  const defaultNotebookHref = (() => {
    const [path, query] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    params.delete('notebookReactPrivate');
    params.delete('notebookCoreReadOnly');
    params.delete('notebookReactEditPrivate');
    params.delete('notebookCoreEditPrivate');
    return `${path}${params.size ? `?${params}` : ''}`;
  })();
  return (
    <ZeppelinThemeProvider>
      <main
        data-testid="react-notebook-entry"
        aria-label={activeCommandPort ? 'Notebook editor preview' : 'Read-only notebook'}
        className="notebook-react-read"
      >
        {hasUnsupportedResult ? (
          <Alert
            type="warning"
            role="alert"
            message="This notebook contains a result that the read-only preview cannot display."
            description={<a href={defaultNotebookHref}>Open the default Angular notebook</a>}
          />
        ) : (
          <NotebookReadContent
            state={state}
            revisionId={snapshot.revisionId}
            draftsById={snapshot.draftsById}
            commandPort={activeCommandPort}
            collaborationBlocked={snapshot.collaborativeMode === true}
            defaultNotebookHref={defaultNotebookHref}
            onResultReady={onResultReady}
            onError={onError}
          />
        )}
      </main>
    </ZeppelinThemeProvider>
  );
};

export const NotebookRouteEntry = ({
  commandPort,
  onReady,
  onError
}: Pick<NotebookRouteEntryProps, 'commandPort' | 'onReady' | 'onError'>) => {
  const snapshot = useNotebookSelector(value => value);
  return (
    <NotebookRouteScreen
      key={`${snapshot.noteId}:${snapshot.revisionId ?? ''}`}
      snapshot={snapshot}
      commandPort={commandPort}
      onReady={onReady}
      onError={onError}
    />
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
          <NotebookRouteEntry commandPort={props.commandPort} onReady={props.onReady} onError={props.onError} />
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
