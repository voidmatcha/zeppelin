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
  NotebookCorePort,
  NotebookCoreRemoteProps,
  NotebookFormValue,
  NotebookPermissions
} from '@zeppelin/notebook-core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot, Root } from 'react-dom/client';

import { ReactErrorBoundary } from '../paragraph/ReactErrorBoundary';
import { SingleResultRenderer } from '../../templates/SingleResultRenderer';
import { useHostThemeMode, ZeppelinThemeProvider } from '../../theme/ZeppelinThemeProvider';
import { NotebookMonacoEditor } from './NotebookMonacoEditor';

const EMPTY_INTERPRETER_BINDINGS = Object.freeze([]);

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
  onParagraphResultConfigChange,
  onNotebookTitleChange,
  onCloneNotebook,
  onExportNotebook,
  onReloadNotebook,
  canTogglePersonalizedMode: hostCanTogglePersonalizedMode = false,
  personalizedMode = false,
  onTogglePersonalizedMode,
  canDeleteNotebook = false,
  isTrashedNotebook = false,
  onDeleteNotebook,
  lookAndFeel = 'default',
  onLookAndFeelChange,
  onShowShortcut,
  revisions = [],
  currentRevision,
  revisionView = false,
  onRevisionSelect,
  onCheckpointNotebook,
  onSetNotebookRevision,
  onRevisionCompare,
  interpreterBindings = EMPTY_INTERPRETER_BINDINGS,
  onInterpreterBindingsChange,
  scheduler,
  canSchedule = false,
  onScheduleChange,
  collaborativeUsers,
  canManagePermissions = false,
  onPermissionsChange,
  onExtensionChange,
  onNoteFormsChange,
  readOnly = false,
  canEdit: hostCanEdit = true,
  canRun: hostCanRun = true
}: NotebookCoreAdapterProps) => {
  const snapshot = useSyncExternalStore(core.subscribe, core.getSnapshot, core.getSnapshot);
  const coreScheduler = snapshot.scheduler ?? scheduler;
  const coreRevisions = snapshot.revisions ?? revisions;
  const coreCurrentRevision = snapshot.revisionId ?? currentRevision ?? 'Head';
  const coreRevisionView = snapshot.revisionId !== null || revisionView;
  const coreLookAndFeel = snapshot.lookAndFeel ?? lookAndFeel;
  const corePersonalizedMode = snapshot.personalizedMode ?? personalizedMode;
  const hostTheme = useHostThemeMode();
  const [commandAccepted, setCommandAccepted] = useState<boolean | null>(null);
  const [titleDraft, setTitleDraft] = useState(snapshot.title ?? '');
  const [searchTerm, setSearchTerm] = useState('');
  const [checkpointMessage, setCheckpointMessage] = useState('');
  const [cronDraft, setCronDraft] = useState(coreScheduler?.cron ?? '');
  const [releaseResourceDraft, setReleaseResourceDraft] = useState(coreScheduler?.releaseResource ?? false);
  const [codeHidden, setCodeHidden] = useState(false);
  const [outputHidden, setOutputHidden] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [interpreterBindingsOpen, setInterpreterBindingsOpen] = useState(false);
  const [interpreterBindingDraft, setInterpreterBindingDraft] = useState(interpreterBindings);
  const [firstRevisionId, setFirstRevisionId] = useState('');
  const [secondRevisionId, setSecondRevisionId] = useState('');
  const [revisionComparison, setRevisionComparison] = useState<Awaited<ReturnType<NonNullable<typeof onRevisionCompare>>> | null>(null);
  const [revisionComparisonError, setRevisionComparisonError] = useState<string | null>(null);
  const [comparingRevisions, setComparingRevisions] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState<NotebookPermissions | null>(snapshot.permissions ?? null);
  const [permissionSaveError, setPermissionSaveError] = useState<string | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [paragraphDrafts, setParagraphDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(snapshot.paragraphs.map(paragraph => [paragraph.id, paragraph.text]))
  );
  const canEdit = hostCanEdit && !readOnly && snapshot.revisionId === null;
  useEffect(() => {
    setTitleDraft(snapshot.title ?? '');
  }, [snapshot.noteId, snapshot.title]);
  useEffect(() => {
    setParagraphDrafts(Object.fromEntries(snapshot.paragraphs.map(paragraph => [paragraph.id, paragraph.text])));
  }, [snapshot.noteId, snapshot.paragraphs]);
  useEffect(() => {
    setPermissionDraft(snapshot.permissions ?? null);
  }, [snapshot.noteId, snapshot.permissions]);
  useEffect(() => setInterpreterBindingDraft(interpreterBindings), [interpreterBindings]);
  useEffect(() => {
    setCronDraft(coreScheduler?.cron ?? '');
    setReleaseResourceDraft(coreScheduler?.releaseResource ?? false);
  }, [coreScheduler?.cron, coreScheduler?.releaseResource]);
  const canRun = (paragraph: (typeof snapshot.paragraphs)[number]): boolean =>
    hostCanRun &&
    !readOnly &&
    snapshot.revisionId === null &&
    snapshot.phase === 'ready' &&
    Boolean(paragraph.text) &&
    paragraph.status !== 'PENDING' &&
    paragraph.status !== 'RUNNING';
  const hasRunningParagraph = snapshot.paragraphs.some(
    paragraph => paragraph.status === 'PENDING' || paragraph.status === 'RUNNING'
  );
  const canTogglePersonalizedMode = hostCanTogglePersonalizedMode && !hasRunningParagraph;

  const dispatch = (type: 'run-paragraph' | 'cancel-paragraph' | 'commit-paragraph', paragraphId: string): void => {
    const accepted = core.dispatch({ type, paragraphId });
    setCommandAccepted(accepted);
  };
  const dispatchNotebook = (
    type: 'run-all-paragraphs' | 'cancel-all-paragraphs' | 'clear-all-paragraph-output'
  ): void => {
    const accepted = core.dispatch({ type });
    setCommandAccepted(accepted);
  };
  const updateNoteForm = (name: string, value: NotebookFormValue): void => {
    onNoteFormsChange?.({ ...snapshot.noteParams, [name]: value });
  };
  const canRenderResult = (type: string): boolean =>
    type === 'TABLE' || type === 'HTML' || type === 'TEXT' || type === 'IMG' || type === 'ANGULAR';
  const updatePermissionDraft = (role: keyof NotebookPermissions, value: string): void => {
    if (!permissionDraft) {
      return;
    }
    setPermissionDraft({
      ...permissionDraft,
      [role]: value
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
    });
  };
  const savePermissions = async (): Promise<void> => {
    if (!permissionDraft || !onPermissionsChange) {
      return;
    }
    if (permissionDraft.owners.length === 0) {
      setPermissionSaveError('At least one owner is required.');
      return;
    }
    setSavingPermissions(true);
    setPermissionSaveError(null);
    try {
      await onPermissionsChange(permissionDraft);
      setPermissionsOpen(false);
      onExtensionChange?.('hide');
    } catch {
      setPermissionSaveError('Unable to save permissions. Please try again.');
    } finally {
      setSavingPermissions(false);
    }
  };
  const compareRevisions = async (): Promise<void> => {
    if (!firstRevisionId || !secondRevisionId || !onRevisionCompare || firstRevisionId === secondRevisionId) {
      return;
    }
    setComparingRevisions(true);
    setRevisionComparisonError(null);
    try {
      setRevisionComparison(await onRevisionCompare(firstRevisionId, secondRevisionId));
    } catch {
      setRevisionComparisonError('Unable to compare revisions. Please try again.');
    } finally {
      setComparingRevisions(false);
    }
  };

  return (
    <section
      aria-label="React Notebook"
      data-testid="notebook-core-react-adapter"
      data-port-shared={expectedCore ? String(core === expectedCore) : 'unknown'}
      data-version={snapshot.version}
      data-note-id={snapshot.noteId}
      data-phase={snapshot.phase}
      data-host-theme={hostTheme}
      data-title={snapshot.title ?? ''}
      data-permission-owner-count={snapshot.permissions?.owners.length ?? 0}
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
        <input aria-label="Search notebook" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} />
        <button
          type="button"
          disabled={
            !hostCanRun || readOnly || snapshot.revisionId !== null || snapshot.phase !== 'ready' || hasRunningParagraph
          }
          onClick={() => dispatchNotebook('run-all-paragraphs')}
        >
          Run all
        </button>
        <button
          type="button"
          disabled={!hostCanRun || readOnly || snapshot.revisionId !== null || !hasRunningParagraph}
          onClick={() => dispatchNotebook('cancel-all-paragraphs')}
        >
          Cancel all
        </button>
        <button type="button" disabled={!canEdit} onClick={() => dispatchNotebook('clear-all-paragraph-output')}>
          Clear all output
        </button>
        <button type="button" onClick={() => setCodeHidden(hidden => !hidden)}>
          {codeHidden ? 'Show code' : 'Hide code'}
        </button>
        <button type="button" onClick={() => setOutputHidden(hidden => !hidden)}>
          {outputHidden ? 'Show output' : 'Hide output'}
        </button>
        <button type="button" onClick={onReloadNotebook}>
          Reload notebook
        </button>
        <button type="button" disabled={!canEdit} onClick={onCloneNotebook}>
          Clone notebook
        </button>
        <button type="button" onClick={onExportNotebook}>
          Export notebook
        </button>
        {canTogglePersonalizedMode ? (
          <button type="button" onClick={onTogglePersonalizedMode}>
            {corePersonalizedMode ? 'Switch to collaboration mode' : 'Switch to personal mode'}
          </button>
        ) : null}
        {canDeleteNotebook ? (
          <button type="button" disabled={hasRunningParagraph} onClick={onDeleteNotebook}>
            {isTrashedNotebook ? 'Delete notebook permanently' : 'Move notebook to trash'}
          </button>
        ) : null}
        <button type="button" disabled={!canEdit} onClick={onShowShortcut}>
          Keyboard shortcuts
        </button>
        <label>
          Look and feel
          <select
            aria-label="Notebook look and feel"
            disabled={!canEdit}
            value={coreLookAndFeel}
            onChange={event => onLookAndFeelChange?.(event.target.value as typeof coreLookAndFeel)}
          >
            <option value="default">default</option>
            <option value="simple">simple</option>
            <option value="report">report</option>
          </select>
        </label>
        {coreRevisions.length > 0 ? (
          <>
            <label>
              Revision
              <select
                aria-label="Notebook revision"
                value={coreCurrentRevision}
                onChange={event => onRevisionSelect?.(event.target.value)}
              >
                {coreRevisions.map(revision => (
                  <option key={revision.id ?? revision.message} value={revision.id ?? ''}>
                    {revision.message}
                  </option>
                ))}
              </select>
            </label>
            {!readOnly && !coreRevisionView ? (
              <label>
                Checkpoint message
                <input
                  aria-label="Checkpoint message"
                  value={checkpointMessage}
                  onChange={event => setCheckpointMessage(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!canEdit || !checkpointMessage.trim()}
                  onClick={() => onCheckpointNotebook?.(checkpointMessage.trim())}
                >
                  Checkpoint
                </button>
              </label>
            ) : null}
            {!readOnly && coreRevisionView ? (
              <button type="button" onClick={onSetNotebookRevision}>
                Set revision as head
              </button>
            ) : null}
          </>
        ) : null}
  {coreScheduler || canSchedule ? (
          <label>
            Scheduler
            <input
              aria-label="Cron expression"
              disabled={!canEdit}
              placeholder="Cron expression"
              value={cronDraft}
              onChange={event => setCronDraft(event.target.value)}
            />
            <input
              aria-label="Release interpreter after schedule"
              checked={releaseResourceDraft}
              disabled={!canEdit}
              type="checkbox"
              onChange={event => setReleaseResourceDraft(event.target.checked)}
            />
            Release interpreter after schedule
            <button
              type="button"
              disabled={!canEdit}
              onClick={() =>
                onScheduleChange?.({
                  cron: cronDraft.trim() || undefined,
                  releaseResource: releaseResourceDraft
                })
              }
            >
              Save schedule
            </button>
          </label>
        ) : null}
        {snapshot.collaborativeUsers !== undefined || collaborativeUsers !== undefined ? (
          <span aria-label="Collaborators">
            Collaborators: {(snapshot.collaborativeUsers ?? collaborativeUsers ?? []).length}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setPermissionsOpen(false);
            setRevisionsOpen(false);
            setInterpreterBindingsOpen(open => !open);
            onExtensionChange?.('interpreter');
          }}
        >
          Interpreter settings
        </button>
        <button
          type="button"
          aria-expanded={permissionsOpen}
          disabled={!snapshot.permissions || !canManagePermissions}
          onClick={() => {
            setPermissionsOpen(open => !open);
            setInterpreterBindingsOpen(false);
            setPermissionSaveError(null);
            onExtensionChange?.('permissions');
          }}
        >
          Permissions
        </button>
        <button
          type="button"
          onClick={() => {
            setPermissionsOpen(false);
            setInterpreterBindingsOpen(false);
            setRevisionsOpen(open => !open);
            setRevisionComparison(null);
            setRevisionComparisonError(null);
            onExtensionChange?.('revisions');
          }}
        >
          Revisions
        </button>
      </header>
      {permissionsOpen && permissionDraft ? (
        <section aria-label="Notebook permissions">
          <h2>Note Permissions</h2>
          <p>Enter comma-separated users and groups. An empty field allows anyone to perform that operation.</p>
          {(['owners', 'writers', 'runners', 'readers'] as const).map(role => (
            <label key={role}>
              {role.slice(0, 1).toUpperCase() + role.slice(1)}
              <input
                aria-label={`${role.slice(0, 1).toUpperCase() + role.slice(1)} permissions`}
                disabled={!canManagePermissions || savingPermissions}
                value={permissionDraft[role].join(', ')}
                onChange={event => updatePermissionDraft(role, event.target.value)}
              />
            </label>
          ))}
          {permissionSaveError ? <p role="alert">{permissionSaveError}</p> : null}
          <button type="button" disabled={!canManagePermissions || savingPermissions} onClick={() => void savePermissions()}>
            Save permissions
          </button>
          <button
            type="button"
            disabled={savingPermissions}
            onClick={() => {
              setPermissionDraft(snapshot.permissions ?? null);
              setPermissionsOpen(false);
              setPermissionSaveError(null);
              onExtensionChange?.('hide');
            }}
          >
            Cancel permissions
          </button>
        </section>
      ) : null}
      {interpreterBindingsOpen ? (
        <section aria-label="Notebook interpreter bindings">
          <h2>Interpreter binding</h2>
          {interpreterBindingDraft.map(binding => (
            <label key={binding.id}>
              <input
                type="checkbox"
                checked={binding.selected}
                onChange={() => setInterpreterBindingDraft(bindings => bindings.map(candidate => candidate.id === binding.id ? { ...candidate, selected: !candidate.selected } : candidate))}
              />
              {binding.name}
            </label>
          ))}
          <button type="button" onClick={() => { onInterpreterBindingsChange?.(interpreterBindingDraft.filter(binding => binding.selected).map(binding => binding.id)); setInterpreterBindingsOpen(false); onExtensionChange?.('hide'); }}>
            Save interpreter bindings
          </button>
          <button type="button" onClick={() => { setInterpreterBindingDraft(interpreterBindings); setInterpreterBindingsOpen(false); onExtensionChange?.('hide'); }}>
            Cancel interpreter bindings
          </button>
        </section>
      ) : null}
      {revisionsOpen ? (
        <section aria-label="Notebook revision comparison">
          <h2>Compare revisions</h2>
          <label>
            First revision
            <select aria-label="First revision" value={firstRevisionId} onChange={event => setFirstRevisionId(event.target.value)}>
              <option value="">Choose...</option>
              {coreRevisions.map(revision => <option key={revision.id} value={revision.id ?? ''}>{revision.message}</option>)}
            </select>
          </label>
          <label>
            Second revision
            <select aria-label="Second revision" value={secondRevisionId} onChange={event => setSecondRevisionId(event.target.value)}>
              <option value="">Choose...</option>
              {coreRevisions.map(revision => <option key={revision.id} value={revision.id ?? ''}>{revision.message}</option>)}
            </select>
          </label>
          <button type="button" disabled={comparingRevisions || !firstRevisionId || firstRevisionId === secondRevisionId} onClick={() => void compareRevisions()}>
            Compare revisions
          </button>
          {revisionComparisonError ? <p role="alert">{revisionComparisonError}</p> : null}
          {revisionComparison ? (
            <section aria-label="Revision comparison results">
              {revisionComparison.secondParagraphs.map(paragraph => {
                const firstParagraph = revisionComparison.firstParagraphs.find(candidate => candidate.id === paragraph.id);
                return (
                  <article key={paragraph.id} aria-label={`Revision paragraph ${paragraph.id}`}>
                    <h3>{paragraph.title ?? paragraph.id}</h3>
                    <pre>{firstParagraph?.text ?? ''}</pre>
                    <pre>{paragraph.text}</pre>
                  </article>
                );
              })}
            </section>
          ) : null}
        </section>
      ) : null}
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
              {paragraph.status === 'RUNNING' ? (
                <progress aria-label={`Paragraph ${index + 1} progress`} max={100} value={paragraph.progress} />
              ) : null}
              {codeHidden ? null : (
                <NotebookMonacoEditor
                  ariaLabel={`Paragraph ${index + 1} editor`}
                  disabled={!canEdit || paragraph.status === 'RUNNING'}
                  language={paragraph.language}
                  searchTerm={searchTerm}
                  value={paragraphDrafts[paragraph.id] ?? paragraph.text}
                  onChange={text => {
                    setParagraphDrafts(drafts => ({ ...drafts, [paragraph.id]: text }));
                    onParagraphTextChange?.(paragraph.id, text);
                  }}
                  onRun={() => dispatch('run-paragraph', paragraph.id)}
                />
              )}
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
                  disabled={
                    !hostCanRun ||
                    readOnly ||
                    snapshot.revisionId !== null ||
                    (paragraph.status !== 'PENDING' && paragraph.status !== 'RUNNING')
                  }
                  onClick={() => dispatch('cancel-paragraph', paragraph.id)}
                >
                  Cancel
                </button>
              </div>
              {!outputHidden && paragraph.results && paragraph.results.length > 0 ? (
                <div data-testid="react-notebook-core-results">
                  {paragraph.results.map((result, resultIndex) => (
                    <div key={resultIndex} data-testid="react-notebook-core-result">
                      {canRenderResult(result.type) ? (
                        <SingleResultRenderer
                          config={paragraph.resultConfigs}
                          index={resultIndex}
                          modeChangeDisabled={!canEdit}
                          onConfigChange={
                            canEdit
                              ? config => onParagraphResultConfigChange?.(paragraph.id, resultIndex, config)
                              : undefined
                          }
                          result={result}
                        />
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
        <ZeppelinThemeProvider>
          <NotebookCoreAdapter {...props} />
        </ZeppelinThemeProvider>
      </ReactErrorBoundary>
    );
  };

  renderWith(initialProps);

  return {
    update: renderWith,
    unmount: () => root.unmount()
  };
};
