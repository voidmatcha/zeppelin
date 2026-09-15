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

import type { MessageService } from '@zeppelin/services';
import { diff_match_patch as DiffMatchPatch } from 'diff-match-patch';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@zeppelin/services', () => ({ MessageService: class {} }));

import { NotebookCoreRouteAdapter } from './notebook-core-route.adapter';

type LoadedNote = Parameters<NotebookCoreRouteAdapter['acceptNote']>[0];

const createNote = (status = 'READY'): LoadedNote =>
  ({
    id: 'note-1',
    name: 'Core command proof',
    paragraphs: [
      {
        id: 'paragraph-1',
        title: 'Proof paragraph',
        text: '%python\nprint("from React")',
        status,
        config: { editorSetting: { params: {}, forms: {} } },
        settings: { params: {}, forms: {} }
      }
    ]
  }) as LoadedNote;

describe('NotebookCoreRouteAdapter command boundary', () => {
  it('projects paragraph presentation and dynamic forms into the shared Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    note.paragraphs[0].config = {
      ...note.paragraphs[0].config,
      title: true,
      lineNumbers: true,
      runOnSelectionChange: true,
      editorSetting: { ...note.paragraphs[0].config.editorSetting!, completionSupport: true }
    };
    note.paragraphs[0].settings = {
      forms: {
        country: { name: 'country', type: 'Select', hidden: false, defaultValue: 'kr', options: [{ value: 'kr' }] }
      },
      params: { country: 'kr' }
    };
    note.paragraphs[0].dateStarted = '2026-09-15T00:00:00.000Z';
    note.paragraphs[0].dateFinished = '2026-09-15T00:01:00.000Z';
    note.paragraphs[0].dateUpdated = '2026-09-15T00:01:00.000Z';
    note.paragraphs[0].user = 'alice';
    note.paragraphs[0].runtimeInfos = {
      jobUrl: {
        propertyName: 'jobUrl',
        label: 'Spark job',
        tooltip: 'Open Spark UI',
        group: 'spark',
        interpreterSettingId: 'spark',
        values: [{ jobUrl: 'https://example.test/jobs/1', applicationId: 'app-1' }]
      }
    };

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({
      title: 'Proof paragraph',
      forms: { country: { name: 'country' } },
      params: { country: 'kr' },
      execution: {
        dateStarted: '2026-09-15T00:00:00.000Z',
        dateFinished: '2026-09-15T00:01:00.000Z',
        dateUpdated: '2026-09-15T00:01:00.000Z',
        user: 'alice'
      },
      runtimeLinks: [{ label: 'Spark job', tooltip: 'Open Spark UI', url: 'https://example.test/jobs/1' }],
      config: { title: true, lineNumbers: true, runOnSelectionChange: true, completionSupport: true }
    });
  });

  it('updates paragraph presentation without treating an unsaved draft as a server save', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphText('paragraph-1', '%python\nlocal draft');
    note.paragraphs[0].title = 'Updated title';
    note.paragraphs[0].config.lineNumbers = true;
    adapter.acceptParagraphPresentation(note.paragraphs[0]);

    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%python\nlocal draft',
      isDirty: true,
      hasConflict: false,
      title: 'Updated title',
      config: { lineNumbers: true }
    });
  });

  it('maps a Core run command to one existing SDK message with the Core text', () => {
    const runParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ runParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'paragraph-1' })).toBe(true);
    expect(runParagraph).toHaveBeenCalledTimes(1);
    expect(runParagraph).toHaveBeenCalledWith(
      'paragraph-1',
      'Proof paragraph',
      '%python\nprint("from React")',
      note.paragraphs[0].config,
      note.paragraphs[0].settings.params
    );
  });

  it('uses current server paragraph metadata for subsequent commands', () => {
    const runParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ runParagraph } as unknown as MessageService);
    const note = createNote();
    const updatedParagraph = {
      ...note.paragraphs[0],
      title: 'Updated title',
      config: { ...note.paragraphs[0].config, colWidth: 6 },
      settings: { ...note.paragraphs[0].settings, params: { current: 'value' } }
    };

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    expect(adapter.acceptParagraphUpdated(updatedParagraph)).toBe(true);

    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'paragraph-1' })).toBe(true);
    expect(runParagraph).toHaveBeenCalledWith(
      'paragraph-1',
      'Updated title',
      '%python\nprint("from React")',
      updatedParagraph.config,
      updatedParagraph.settings.params
    );
  });

  it('applies terminal output snapshots and output clearing from paragraph updates', () => {
    const adapter = new NotebookCoreRouteAdapter({ getParagraphOutput: vi.fn() } as unknown as MessageService);
    const note = createNote('RUNNING');

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphUpdated({
      ...note.paragraphs[0],
      status: 'FINISHED',
      results: { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'complete' }] }
    });

    expect(adapter.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'complete' }]);

    adapter.acceptParagraphUpdated({ ...note.paragraphs[0], status: 'FINISHED', results: undefined });
    expect(adapter.port.getSnapshot().paragraphs[0].results).toBeUndefined();
  });

  it('projects terminal server fields together with the latest Core text', () => {
    const adapter = new NotebookCoreRouteAdapter({ getParagraphOutput: vi.fn() } as unknown as MessageService);
    const note = createNote('RUNNING');
    const finalResult = { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'complete' }] };

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphText('paragraph-1', '%python\nlocal draft');
    adapter.acceptParagraphUpdated({
      ...note.paragraphs[0],
      title: 'Finished title',
      text: '%python\nserver edit',
      status: 'FINISHED',
      dateFinished: '2026-09-15T01:00:00.000Z',
      results: finalResult,
      config: { ...note.paragraphs[0].config, colWidth: 6 },
      settings: { ...note.paragraphs[0].settings, params: { final: 'value' } }
    });

    expect(adapter.projectParagraphViewsFromCore()?.[0]).toMatchObject({
      title: 'Finished title',
      text: '%python\nlocal draft',
      status: 'FINISHED',
      dateFinished: '2026-09-15T01:00:00.000Z',
      results: finalResult,
      config: { colWidth: 6 },
      settings: { params: { final: 'value' } }
    });
  });

  it('projects an unsaved Core draft back into the Angular paragraph view', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphText('paragraph-1', '%python\nprint("retained draft")');
    adapter.acceptParagraphStatus('paragraph-1', 'RUNNING');
    adapter.acceptParagraphProgress('paragraph-1', 40);
    adapter.acceptParagraphOutputUpdate(note.id, 'paragraph-1', 0, 'TEXT', 'retained output');

    expect(adapter.projectParagraphViewsFromCore()?.[0]).toMatchObject({
      text: '%python\nprint("retained draft")',
      status: 'RUNNING',
      progress: 40,
      results: { msg: [{ type: 'TEXT', data: 'retained output' }] }
    });
  });

  it('preserves a local draft when a paragraph update is followed by an insert', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    const draft = '%python\nlocal draft';

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphText('paragraph-1', draft);
    adapter.acceptParagraphUpdated({ ...note.paragraphs[0], text: '%python\nstale server text' });

    const paragraphs = adapter.acceptParagraphAdded({ ...note.paragraphs[0], id: 'paragraph-2', text: '%python' }, 0);

    expect(paragraphs?.map(paragraph => [paragraph.id, paragraph.text])).toEqual([
      ['paragraph-2', '%python'],
      ['paragraph-1', draft]
    ]);
  });

  it('preserves the current snapshot while requesting a reconnect snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.reloadCurrentRoute();

    expect(adapter.port.getSnapshot()).toMatchObject({
      noteId: note.id,
      phase: 'loading',
      title: note.name,
      paragraphs: [expect.objectContaining({ id: 'paragraph-1' })]
    });
  });

  it('maps Core notebook-wide execution and cancellation to existing SDK messages', () => {
    const runAllParagraphs = vi.fn();
    const cancelAllParagraphs = vi.fn();
    const paragraphClearAllOutput = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({
      runAllParagraphs,
      cancelAllParagraphs,
      paragraphClearAllOutput
    } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.port.dispatch({ type: 'run-all-paragraphs' })).toBe(true);
    expect(runAllParagraphs).toHaveBeenCalledWith(note.id, [
      {
        id: 'paragraph-1',
        title: 'Proof paragraph',
        paragraph: '%python\nprint("from React")',
        config: note.paragraphs[0].config,
        params: note.paragraphs[0].settings.params
      }
    ]);
    expect(adapter.port.dispatch({ type: 'cancel-all-paragraphs' })).toBe(false);

    adapter.acceptParagraphStatus('paragraph-1', 'RUNNING');
    expect(adapter.port.dispatch({ type: 'run-all-paragraphs' })).toBe(false);
    expect(adapter.port.dispatch({ type: 'cancel-all-paragraphs' })).toBe(true);
    expect(cancelAllParagraphs).toHaveBeenCalledWith(note.id);

    expect(adapter.port.dispatch({ type: 'clear-all-paragraph-output' })).toBe(true);
    expect(paragraphClearAllOutput).toHaveBeenCalledWith(note.id);
  });

  it('does not run all paragraphs while any paragraph has an unresolved edit conflict', () => {
    const runAllParagraphs = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ runAllParagraphs } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.port.dispatch({ type: 'edit-paragraph', paragraphId: 'paragraph-1', text: '%python\nlocal()' });
    adapter.acceptParagraphUpdated({ ...note.paragraphs[0], text: '%python\npeer()' });

    expect(adapter.port.dispatch({ type: 'run-all-paragraphs' })).toBe(false);
    expect(runAllParagraphs).not.toHaveBeenCalled();
  });

  it('accepts a repeated paragraph text event without dispatching another edit', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    expect(adapter.updateParagraphText('paragraph-1', '%python\nlocal()')).toBe(true);
    const version = adapter.port.getSnapshot().version;

    expect(adapter.updateParagraphText('paragraph-1', '%python\nlocal()')).toBe(true);
    expect(adapter.port.getSnapshot().version).toBe(version);
  });

  it('projects the latest draft after an earlier save response arrives', () => {
    const commitParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ commitParagraph } as unknown as MessageService);
    const note = createNote();
    const firstText = '%python\nfirst()';
    const latestText = '%python\nlatest()';

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    expect(adapter.updateParagraphText('paragraph-1', firstText)).toBe(true);
    expect(adapter.port.dispatch({ type: 'commit-paragraph', paragraphId: 'paragraph-1' })).toBe(true);
    expect(adapter.updateParagraphText('paragraph-1', latestText)).toBe(true);

    expect(adapter.acceptParagraphUpdated({ ...note.paragraphs[0], text: firstText })).toBe(true);

    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({ text: latestText, isDirty: true });
    expect(adapter.projectParagraphViewsFromCore()?.[0].text).toBe(latestText);
  });

  it('maps saved paragraph result configuration into the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    note.paragraphs[0].config.results = { '0': { graph: { mode: 'lineChart' } } };

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.port.getSnapshot().paragraphs[0].resultConfigs).toEqual({ '0': { graph: { mode: 'lineChart' } } });
  });

  it('maps the existing paragraph editor language into the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    note.paragraphs[0].config.editorSetting!.language = 'sql';

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.port.getSnapshot().paragraphs[0].language).toBe('sql');
  });

  it('projects editor capabilities returned for a React paragraph without changing its text state', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphText('paragraph-1', '%scala\nprintln(1)');
    adapter.acceptEditorSetting({
      paragraphId: 'paragraph-1',
      editor: { completionSupport: true, editOnDblClick: true, language: 'scala' }
    });

    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: '%scala\nprintln(1)',
      isDirty: true,
      hasConflict: false,
      language: 'scala',
      config: { completionSupport: true, editOnDblClick: true }
    });
    expect(adapter.getParagraphView('paragraph-1')?.config.editorSetting).toMatchObject({
      completionSupport: true,
      editOnDblClick: true,
      language: 'scala'
    });
  });

  it('maps collaborative-mode status into the Core snapshot for the React adapter', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptCollaborativeModeStatus(['alice', 'bob']);

    expect(adapter.port.getSnapshot().collaborativeUsers).toEqual(['alice', 'bob']);
    adapter.acceptCollaborativeModeStatus(null);
    expect(adapter.port.getSnapshot().collaborativeUsers).toBeUndefined();
  });

  it('maps the existing permissions response into the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptPermissions({ readers: ['reader'], owners: ['owner'], writers: ['writer'], runners: ['runner'] });

    expect(adapter.port.getSnapshot().permissions).toEqual({
      readers: ['reader'],
      owners: ['owner'],
      writers: ['writer'],
      runners: ['runner']
    });
  });

  it('maps the existing scheduler configuration into the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    note.config = {
      isZeppelinNotebookCronEnable: true,
      cron: '0 0/5 * * * ?',
      releaseresource: true,
      noteFormTitle: 'Filters'
    };
    note.info = { cron: 'Last run failed' };

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    expect(adapter.port.getSnapshot().scheduler).toEqual({
      cron: '0 0/5 * * * ?',
      releaseResource: true,
      status: 'Last run failed'
    });
    expect(adapter.port.getSnapshot().noteFormTitle).toBe('Filters');

    adapter.acceptNoteFormTitle('Deployment filters');
    expect(adapter.port.getSnapshot().noteFormTitle).toBe('Deployment filters');

    adapter.acceptSchedule(null);
    expect(adapter.port.getSnapshot().scheduler).toBeUndefined();
  });

  it('maps the existing look-and-feel configuration into the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    note.config = { looknfeel: 'simple' };

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    expect(adapter.port.getSnapshot().lookAndFeel).toBe('simple');

    adapter.acceptLookAndFeel('report');
    expect(adapter.port.getSnapshot().lookAndFeel).toBe('report');
  });

  it('maps personalized mode into the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    note.config = { personalizedMode: 'true' };

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    expect(adapter.port.getSnapshot().personalizedMode).toBe(true);

    adapter.acceptPersonalizedMode(false);
    expect(adapter.port.getSnapshot().personalizedMode).toBe(false);
  });

  it('maps the existing revision list into the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptRevisions([
      { id: 'Head', message: 'Head' },
      { id: 'revision-1', message: 'First checkpoint', time: 1 }
    ]);

    expect(adapter.port.getSnapshot().revisions).toEqual([
      { id: 'Head', message: 'Head' },
      { id: 'revision-1', message: 'First checkpoint', time: 1 }
    ]);
  });

  it('commits an updated result configuration through the existing paragraph contract', () => {
    const commitParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ commitParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.updateParagraphResultConfig('paragraph-1', 0, { graph: { mode: 'lineChart' } })).toBe(true);
    expect(adapter.port.getSnapshot().paragraphs[0].resultConfigs).toEqual({ '0': { graph: { mode: 'lineChart' } } });
    expect(commitParagraph).toHaveBeenCalledWith(
      'paragraph-1',
      'Proof paragraph',
      '%python\nprint("from React")',
      expect.objectContaining({ results: { '0': { graph: { mode: 'lineChart' } } } }),
      note.paragraphs[0].settings.params,
      note.id
    );
  });

  it('does not commit result configuration with conflicted paragraph text', () => {
    const commitParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ commitParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.port.dispatch({ type: 'edit-paragraph', paragraphId: 'paragraph-1', text: '%python\nlocal()' });
    adapter.acceptParagraphUpdated({ ...note.paragraphs[0], text: '%python\npeer()' });

    expect(adapter.updateParagraphResultConfig('paragraph-1', 0, { graph: { mode: 'lineChart' } })).toBe(false);
    expect(commitParagraph).not.toHaveBeenCalled();
  });

  it('maps a progress event into the Core paragraph snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({ getParagraphOutput: vi.fn() } as unknown as MessageService);
    const note = createNote('RUNNING');

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphProgress('paragraph-1', 55);

    expect(adapter.port.getSnapshot().paragraphs[0].progress).toBe(55);
  });

  it('requests current output when loading a paragraph that is already running', () => {
    const getParagraphOutput = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ getParagraphOutput } as unknown as MessageService);
    const note = createNote('RUNNING');

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(getParagraphOutput).toHaveBeenCalledWith(note.id, 'paragraph-1');
  });

  it('requests an authoritative output snapshot when a new run skips a sequenced frame', () => {
    const getParagraphOutput = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ getParagraphOutput } as unknown as MessageService);
    const note = createNote('RUNNING');

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphStatus('paragraph-1', 'PENDING');
    adapter.acceptParagraphOutputAppend(note.id, 'paragraph-1', 0, 'second frame', 2);

    expect(getParagraphOutput).toHaveBeenCalledWith(note.id, 'paragraph-1');
    expect(adapter.port.getSnapshot().paragraphs[0].results).toBeUndefined();

    adapter.acceptParagraphOutputSnapshot(note.id, 'paragraph-1', [{ type: 'TEXT', data: 'recovered output' }], 2);
    expect(adapter.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'recovered output' }]);

    adapter.acceptParagraphOutputAppend(note.id, 'paragraph-1', 0, ' duplicate', 2);
    expect(adapter.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'recovered output' }]);

    adapter.acceptParagraphOutputSnapshot(note.id, 'paragraph-1', [{ type: 'TEXT', data: 'stale snapshot' }], 1);
    expect(adapter.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'recovered output' }]);
  });

  it('rejects output snapshots from another note and from the live note while viewing a revision', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    note.paragraphs[0].results = { code: 0, msg: [{ type: 'TEXT', data: 'historical output' }] };

    adapter.enterRoute(note.id, 'revision-1');
    adapter.acceptNote(note, 'revision-1');
    adapter.acceptParagraphOutputSnapshot(note.id, 'paragraph-1', [{ type: 'TEXT', data: 'live output' }], 1);
    adapter.acceptParagraphOutputSnapshot('other-note', 'paragraph-1', [{ type: 'TEXT', data: 'other output' }], 2);

    expect(adapter.port.getSnapshot().paragraphs[0].results).toEqual([{ type: 'TEXT', data: 'historical output' }]);
  });

  it('rejects run commands for revisions, missing paragraphs, and active paragraphs', () => {
    const runParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({
      getParagraphOutput: vi.fn(),
      runParagraph
    } as unknown as MessageService);
    const note = createNote('RUNNING');

    adapter.enterRoute(note.id, 'revision-1');
    adapter.acceptNote(note, 'revision-1');

    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'paragraph-1' })).toBe(false);
    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'missing' })).toBe(false);
    expect(runParagraph).not.toHaveBeenCalled();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'paragraph-1' })).toBe(false);
    expect(runParagraph).not.toHaveBeenCalled();
  });

  it('maps a dirty Core draft to one existing commit message with the Core text', () => {
    const commitParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ commitParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphText('paragraph-1', '%python\nprint("Core draft")');

    expect(adapter.port.dispatch({ type: 'commit-paragraph', paragraphId: 'paragraph-1' })).toBe(true);
    expect(commitParagraph).toHaveBeenCalledTimes(1);
    expect(commitParagraph).toHaveBeenCalledWith(
      'paragraph-1',
      'Proof paragraph',
      '%python\nprint("Core draft")',
      note.paragraphs[0].config,
      note.paragraphs[0].settings.params,
      note.id
    );
    expect(adapter.port.dispatch({ type: 'commit-paragraph', paragraphId: 'paragraph-1' })).toBe(false);
    expect(commitParagraph).toHaveBeenCalledTimes(1);
  });

  it('runs the latest Core draft exactly once', () => {
    const runParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ runParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.port.dispatch({ type: 'edit-paragraph', paragraphId: 'paragraph-1', text: '%python\nprint("latest")' });

    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'paragraph-1' })).toBe(true);
    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'paragraph-1' })).toBe(false);
    expect(runParagraph).toHaveBeenCalledTimes(1);
    expect(runParagraph).toHaveBeenCalledWith(
      'paragraph-1',
      'Proof paragraph',
      '%python\nprint("latest")',
      note.paragraphs[0].config,
      note.paragraphs[0].settings.params
    );
  });

  it('maps a Core cancel command to one existing SDK message', () => {
    const cancelParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ cancelParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.port.dispatch({ type: 'cancel-paragraph', paragraphId: 'paragraph-1' })).toBe(true);
    expect(cancelParagraph).toHaveBeenCalledWith('paragraph-1');
  });

  it('maps a collaboration patch to one existing SDK message for the active note', () => {
    const patchParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ patchParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.sendParagraphPatch('paragraph-1', '@@ -1,1 +1,1 @@\n-old\n+new\n')).toBe(true);
    expect(patchParagraph).toHaveBeenCalledWith('paragraph-1', note.id, '@@ -1,1 +1,1 @@\n-old\n+new\n');
  });

  it('creates and sends a collaboration patch for a Core edit from either renderer', () => {
    const patchParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ patchParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptCollaborativeModeStatus([]);

    expect(
      adapter.port.dispatch({ type: 'edit-paragraph', paragraphId: 'paragraph-1', text: '%python\nprint("peer")' })
    ).toBe(true);
    expect(patchParagraph).toHaveBeenCalledOnce();
    const [paragraphId, noteId, patch] = patchParagraph.mock.calls[0];
    const dmp = new DiffMatchPatch();
    expect(paragraphId).toBe('paragraph-1');
    expect(noteId).toBe(note.id);
    expect(dmp.patch_apply(dmp.patch_fromText(patch), note.paragraphs[0].text)[0]).toBe('%python\nprint("peer")');
  });

  it('updates Core state for a React text edit without bypassing the command port', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(
      adapter.port.dispatch({ type: 'edit-paragraph', paragraphId: 'paragraph-1', text: 'updated from React' })
    ).toBe(true);
    expect(adapter.port.getSnapshot().paragraphs[0].text).toBe('updated from React');
  });

  it('applies an inbound collaboration patch to the Core snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    const updatedText = '%python\nprint("from Angular collaborator")';
    const diffMatchPatch = new DiffMatchPatch();
    const patch = diffMatchPatch.patch_toText(diffMatchPatch.patch_make(note.paragraphs[0].text, updatedText));

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.acceptParagraphPatch('paragraph-1', patch)).toBe(true);
    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({ text: updatedText, isDirty: false });
  });

  it('keeps an outbound patch dirty until an inbound collaboration update confirms server state', () => {
    const patchParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ patchParagraph } as unknown as MessageService);
    const note = createNote();
    const localText = '%python\nprint("local")';
    const peerText = '%python\nprint("local and peer")';
    const diffMatchPatch = new DiffMatchPatch();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptCollaborativeModeStatus([]);

    expect(adapter.port.dispatch({ type: 'edit-paragraph', paragraphId: 'paragraph-1', text: localText })).toBe(true);
    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({ text: localText, isDirty: true });

    const peerPatch = diffMatchPatch.patch_toText(diffMatchPatch.patch_make(localText, peerText));
    expect(adapter.acceptParagraphPatch('paragraph-1', peerPatch)).toBe(true);
    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({
      text: peerText,
      isDirty: true,
      hasConflict: false
    });
  });

  it('rejects an inbound collaboration patch while local conflict resolution is pending', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();
    const diffMatchPatch = new DiffMatchPatch();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphText('paragraph-1', 'local draft');
    adapter.acceptParagraphUpdated({ ...note.paragraphs[0], text: 'server edit' });

    const patch = diffMatchPatch.patch_toText(diffMatchPatch.patch_make('local draft', 'peer edit'));
    expect(adapter.acceptParagraphPatch('paragraph-1', patch)).toBe(false);
    expect(adapter.port.getSnapshot().paragraphs[0]).toMatchObject({ text: 'local draft', hasConflict: true });
  });

  it('rejects an inbound collaboration patch for an unknown paragraph', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.acceptParagraphPatch('missing', '@@ -1,1 +1,1 @@\n-old\n+new\n')).toBe(false);
  });
});
