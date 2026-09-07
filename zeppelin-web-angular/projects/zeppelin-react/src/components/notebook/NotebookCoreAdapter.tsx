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

import type { NotebookCorePort, NotebookCoreRemoteProps, NotebookFormValue } from '@zeppelin/notebook-core';
import { DatasetType, type ParagraphIResultsMsgItem } from '@zeppelin/sdk';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot, Root } from 'react-dom/client';

import { ReactErrorBoundary } from '../paragraph/ReactErrorBoundary';
import { SingleResultRenderer } from '../../templates/SingleResultRenderer';

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
  onNotebookTitleChange,
  onNoteFormsChange,
  readOnly = false
}: NotebookCoreAdapterProps) => {
  const snapshot = useSyncExternalStore(core.subscribe, core.getSnapshot, core.getSnapshot);
  const [commandAccepted, setCommandAccepted] = useState<boolean | null>(null);
  const [titleDraft, setTitleDraft] = useState(snapshot.title ?? '');
  const canEdit = !readOnly && snapshot.revisionId === null;
  useEffect(() => {
    setTitleDraft(snapshot.title ?? '');
  }, [snapshot.noteId, snapshot.title]);
  const canRun = (paragraph: (typeof snapshot.paragraphs)[number]): boolean =>
    canEdit &&
    snapshot.phase === 'ready' &&
    Boolean(paragraph.text) &&
    paragraph.status !== 'PENDING' &&
    paragraph.status !== 'RUNNING';

  const dispatch = (type: 'run-paragraph' | 'cancel-paragraph' | 'commit-paragraph', paragraphId: string): void => {
    const accepted = core.dispatch({ type, paragraphId });
    setCommandAccepted(accepted);
  };
  const updateNoteForm = (name: string, value: NotebookFormValue): void => {
    onNoteFormsChange?.({ ...snapshot.noteParams, [name]: value });
  };
  const toRenderedResult = (type: string, data: string): ParagraphIResultsMsgItem => ({
    type: type as DatasetType,
    data
  });
  const canRenderResult = (type: string): boolean =>
    type === DatasetType.TABLE ||
    type === DatasetType.HTML ||
    type === DatasetType.TEXT ||
    type === DatasetType.IMG ||
    type === DatasetType.ANGULAR;

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
          disabled={!canEdit}
          value={titleDraft}
          onChange={event => setTitleDraft(event.target.value)}
          onBlur={() => onNotebookTitleChange?.(titleDraft)}
        />
        <span>{snapshot.paragraphs.length} paragraphs</span>
      </header>
      <nav aria-label="Notebook outline">
        <ol>
          {snapshot.paragraphs.map((paragraph, index) => (
            <li key={paragraph.id}>
              <a href={`#react-notebook-paragraph-${paragraph.id}`}>Paragraph {index + 1}</a>
            </li>
          ))}
        </ol>
      </nav>
      {Object.values(snapshot.noteForms).some(form => !form.hidden) ? (
        <fieldset aria-label="Notebook forms">
          <legend>Notebook forms</legend>
          {Object.entries(snapshot.noteForms).map(([name, form]) => {
            if (form.hidden) {
              return null;
            }
            const value = snapshot.noteParams[name] ?? form.defaultValue;
            const label = form.displayName ?? form.name;
            if (form.type === 'Select') {
              return (
                <label key={name}>
                  {label}
                  <select
                    aria-label={label}
                    disabled={!canEdit}
                    value={Array.isArray(value) ? (value[0] ?? '') : value}
                    onChange={event => updateNoteForm(name, event.target.value)}
                  >
                    {(form.options ?? []).map(option => (
                      <option key={option.value} value={option.value}>
                        {option.displayName ?? option.value}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            if (form.type === 'CheckBox') {
              const selected = Array.isArray(value) ? value : value ? [value] : [];
              return (
                <fieldset key={name}>
                  <legend>{label}</legend>
                  {(form.options ?? []).map(option => (
                    <label key={option.value}>
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={selected.includes(option.value)}
                        onChange={event =>
                          updateNoteForm(
                            name,
                            event.target.checked
                              ? [...selected, option.value]
                              : selected.filter(candidate => candidate !== option.value)
                          )
                        }
                      />
                      {option.displayName ?? option.value}
                    </label>
                  ))}
                </fieldset>
              );
            }
            return (
              <label key={name}>
                {label}
                <input
                  aria-label={label}
                  type={form.type === 'Password' ? 'password' : 'text'}
                  disabled={!canEdit}
                  value={Array.isArray(value) ? value.join(',') : value}
                  onChange={event => updateNoteForm(name, event.target.value)}
                />
              </label>
            );
          })}
        </fieldset>
      ) : null}
      <ol aria-label="Notebook paragraphs">
        {snapshot.paragraphs.map((paragraph, index) => (
          <li key={paragraph.id} data-testid={`notebook-core-paragraph-${paragraph.id}`}>
            <article id={`react-notebook-paragraph-${paragraph.id}`} aria-label={`Paragraph ${index + 1}`}>
              <header>
                <strong>Paragraph {index + 1}</strong>
                <span>{paragraph.status}</span>
              </header>
              <textarea
                aria-label={`Paragraph ${index + 1} editor`}
                disabled={!canEdit || paragraph.status === 'RUNNING'}
                value={paragraph.text}
                onChange={event => onParagraphTextChange?.(paragraph.id, event.target.value)}
              />
              <div>
                <button type="button" disabled={!canEdit} onClick={() => onParagraphInsert?.(index)}>
                  Add above
                </button>
                <button type="button" disabled={!canEdit} onClick={() => onParagraphInsert?.(index + 1)}>
                  Add below
                </button>
                <button
                  type="button"
                  disabled={!canEdit || index === 0}
                  onClick={() => onParagraphMove?.(paragraph.id, index - 1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={!canEdit || index === snapshot.paragraphs.length - 1}
                  onClick={() => onParagraphMove?.(paragraph.id, index + 1)}
                >
                  Move down
                </button>
                <button type="button" disabled={!canEdit} onClick={() => onParagraphRemove?.(paragraph.id)}>
                  Delete
                </button>
                <button
                  type="button"
                  disabled={!canEdit || !paragraph.isDirty}
                  onClick={() => dispatch('commit-paragraph', paragraph.id)}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={!canRun(paragraph)}
                  onClick={() => dispatch('run-paragraph', paragraph.id)}
                >
                  Run
                </button>
                <button
                  type="button"
                  disabled={!canEdit || (paragraph.status !== 'PENDING' && paragraph.status !== 'RUNNING')}
                  onClick={() => dispatch('cancel-paragraph', paragraph.id)}
                >
                  Cancel
                </button>
              </div>
              {paragraph.results && paragraph.results.length > 0 ? (
                <div data-testid="react-notebook-core-results">
                  {paragraph.results.map((result, resultIndex) => (
                    <div key={resultIndex} data-testid="react-notebook-core-result">
                      {canRenderResult(result.type) ? (
                        <SingleResultRenderer index={resultIndex} result={toRenderedResult(result.type, result.data)} />
                      ) : (
                        <pre>{result.data}</pre>
                      )}
                    </div>
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
