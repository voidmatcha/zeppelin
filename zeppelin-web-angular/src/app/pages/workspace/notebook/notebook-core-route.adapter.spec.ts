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

import type { NgZService } from '@zeppelin/services/ng-z.service';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@zeppelin/services/ng-z.service', () => ({ NgZService: class {} }));

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
  it('maps a Core run command to the existing Angular paragraph action exactly once', () => {
    const runParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ runParagraph } as unknown as NgZService);
    const note = createNote();

    adapter.enterRoute(note.id, null);
    adapter.acceptNote(note, null);

    expect(adapter.port.dispatch({ type: 'run-paragraph', paragraphId: 'paragraph-1' })).toBe(true);
    expect(runParagraph).toHaveBeenCalledTimes(1);
    expect(runParagraph).toHaveBeenCalledWith('paragraph-1');
  });

  it('rejects run commands for revisions, missing paragraphs, and active paragraphs', () => {
    const runParagraph = vi.fn();
    const adapter = new NotebookCoreRouteAdapter({ runParagraph } as unknown as NgZService);
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
});
