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

  it('maps a progress event into the Core paragraph snapshot', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote('RUNNING');

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);
    adapter.acceptParagraphProgress('paragraph-1', 55);

    expect(adapter.port.getSnapshot().paragraphs[0].progress).toBe(55);
  });

  it('rejects run commands for revisions, missing paragraphs, and active paragraphs', () => {
    const runParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ runParagraph } as unknown as MessageService);
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

  it('updates the Core and sends a collaboration patch for a React text edit', () => {
    const patchParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ patchParagraph } as unknown as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.updateParagraphText('paragraph-1', 'updated from React')).toBe(true);
    expect(adapter.port.getSnapshot().paragraphs[0].text).toBe('updated from React');
    expect(patchParagraph).toHaveBeenCalledWith('paragraph-1', note.id, expect.any(String));
    const patch = patchParagraph.mock.calls[0][2];
    const [updatedText, applied] = new DiffMatchPatch().patch_apply(
      new DiffMatchPatch().patch_fromText(patch),
      note.paragraphs[0].text
    );
    expect(applied.every(Boolean)).toBe(true);
    expect(updatedText).toBe('updated from React');
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

  it('rejects an inbound collaboration patch for an unknown paragraph', () => {
    const adapter = new NotebookCoreRouteAdapter({} as MessageService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.acceptParagraphPatch('missing', '@@ -1,1 +1,1 @@\n-old\n+new\n')).toBe(false);
  });
});
