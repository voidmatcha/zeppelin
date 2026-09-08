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

import { ChangeDetectorRef } from '@angular/core';
import { DatasetType, Message, ParagraphItem } from '@zeppelin/sdk';
import { EMPTY } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AngularContextManager } from './angular-context-manager';
import { ParagraphBase } from './paragraph-base';

class TestParagraph extends ParagraphBase {
  changeColWidth = vi.fn();
  updateParagraphResult = vi.fn();
  protected currentNoteId = 'note';

  hydrate(snapshot: ParagraphItem) {
    this.setParagraphSnapshot(snapshot);
  }

  constructor(paragraph: ParagraphItem) {
    super(
      { receive: () => EMPTY } as unknown as Message,
      { isParagraphRunning: item => item.status === 'RUNNING', isEntireNoteRunning: () => false },
      {} as AngularContextManager,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef
    );
    this.paragraph = paragraph;
  }
}

const paragraph = (id: string, status = 'RUNNING', dateStarted = '2026-01-01T00:00:00Z'): ParagraphItem => ({
  id,
  status,
  dateStarted,
  text: '',
  user: 'anonymous',
  dateUpdated: '',
  dateCreated: '',
  config: {},
  settings: { params: {}, forms: {} },
  apps: [],
  progressUpdateIntervalMs: 500,
  jobName: '',
  aborted: false,
  lineNumbers: false,
  fontSize: 9
});

const beginOutput = (component: TestParagraph) =>
  component.onParagraphUpdateOutput({
    noteId: 'note',
    paragraphId: 'A',
    index: 0,
    type: DatasetType.TEXT,
    data: 'first\n'
  });

const appendOutput = (component: TestParagraph) =>
  component.onParagraphAppendOutput({ noteId: 'note', paragraphId: 'A', index: 0, data: 'second\n' });

describe('ParagraphBase streaming state isolation', () => {
  it('ignores a scoped paragraph snapshot from another note with the same paragraph ID', () => {
    const component = new TestParagraph(paragraph('A'));
    beginOutput(component);
    component.paragraphData({ noteId: 'other-note', paragraph: paragraph('A', 'FINISHED') });
    appendOutput(component);
    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\nsecond\n' }]);
    component.ngOnDestroy();
  });

  it.each(['append', 'update'])('ignores %s from another note with the same paragraph ID', kind => {
    const component = new TestParagraph(paragraph('A'));
    beginOutput(component);
    if (kind === 'append') {
      component.onParagraphAppendOutput({ noteId: 'other-note', paragraphId: 'A', index: 0, data: 'foreign' });
    } else {
      component.onParagraphUpdateOutput({
        noteId: 'other-note',
        paragraphId: 'A',
        index: 0,
        type: DatasetType.HTML,
        data: 'foreign'
      });
    }
    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\n' }]);
    component.ngOnDestroy();
  });

  it.each(['FINISHED', 'ERROR', 'ABORT', 'RUNNING', 'PENDING'])(
    'keeps accumulating output when another paragraph becomes %s',
    status => {
      const component = new TestParagraph(paragraph('A'));
      beginOutput(component);

      component.paragraphData({ paragraph: paragraph('B', status, '2026-01-01T00:00:01Z') });
      appendOutput(component);

      expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\nsecond\n' }]);
      expect(component.paragraph?.id).toBe('A');
      component.ngOnDestroy();
    }
  );

  it('ignores late output after its own terminal snapshot', () => {
    const component = new TestParagraph(paragraph('A'));
    beginOutput(component);
    const finished = { ...paragraph('A', 'FINISHED'), results: { msg: [{ type: DatasetType.TEXT, data: 'final\n' }] } };

    component.paragraphData({ paragraph: finished });
    appendOutput(component);

    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'final\n' }]);
    component.ngOnDestroy();
  });

  it('accepts fresh output when its own paragraph starts a new run', () => {
    const component = new TestParagraph(paragraph('A'));
    beginOutput(component);
    component.paragraphData({ paragraph: paragraph('A', 'FINISHED') });
    component.paragraphData({ paragraph: paragraph('A', 'RUNNING', '2026-01-01T00:00:01Z') });

    beginOutput(component);
    appendOutput(component);

    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\nsecond\n' }]);
    component.ngOnDestroy();
  });
});

describe('ParagraphBase streaming boundaries', () => {
  it('preserves a saved revision during live output and lifecycle messages', () => {
    const component = new TestParagraph(paragraph('A', 'FINISHED'));
    const saved = [{ type: DatasetType.TEXT, data: 'saved revision' }];
    component.paragraph!.results = { msg: saved };
    component.results = saved;
    component.revisionView = true;

    component.paragraphData({ paragraph: paragraph('A', 'RUNNING', '2026-01-01T00:00:01Z') });
    beginOutput(component);
    appendOutput(component);
    component.paragraphData({ paragraph: paragraph('A') });

    expect(component.results).toEqual(saved);
    expect(component.paragraph?.status).toBe('FINISHED');
    component.revisionView = false;
    beginOutput(component);
    expect(component.results).toEqual(saved);
    component.ngOnDestroy();
  });

  it('does not refresh an unchanged paragraph for an omitted run timestamp', () => {
    const component = new TestParagraph(paragraph('A'));
    const update = vi.spyOn(component, 'updateParagraph');
    const statusOnly = paragraph('A');
    delete statusOnly.dateStarted;

    component.paragraphData({ paragraph: statusOnly });
    component.paragraphData({ paragraph: statusOnly });

    expect(update).not.toHaveBeenCalled();
    expect(component.paragraph?.dateStarted).toBe('2026-01-01T00:00:00Z');
    component.paragraphData({ paragraph: paragraph('A', 'RUNNING', '2026-01-01T00:00:01Z') });
    expect(update).toHaveBeenCalledOnce();
    expect(component.paragraph?.dateStarted).toBe('2026-01-01T00:00:01Z');
    component.ngOnDestroy();
  });

  it('preserves streamed types across a status snapshot without a run timestamp', () => {
    const component = new TestParagraph(paragraph('A', 'PENDING'));
    beginOutput(component);
    const running = paragraph('A');
    delete running.dateStarted;
    component.paragraphData({ paragraph: running });
    component.paragraphData({ paragraph: paragraph('A') });
    appendOutput(component);

    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\nsecond\n' }]);
    expect(component.paragraph?.dateStarted).toBe('2026-01-01T00:00:00Z');
    component.ngOnDestroy();
  });

  it('preserves streaming output across ordinary RUNNING and unrelated paragraph snapshots', () => {
    const component = new TestParagraph(paragraph('A'));
    beginOutput(component);
    component.paragraphData({ paragraph: paragraph('A') });
    component.paragraphData({ paragraph: paragraph('B') });
    appendOutput(component);
    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\nsecond\n' }]);
    component.ngOnDestroy();
  });

  it('buffers sparse result slots without rendering holes or changing server indexes', () => {
    const component = new TestParagraph(paragraph('A'));
    component.onParagraphAppendOutput({ noteId: 'note', paragraphId: 'A', index: 2, data: ' tail' });
    component.setResults(component.paragraph!);
    component.onParagraphUpdateOutput({
      noteId: 'note',
      paragraphId: 'A',
      index: 2,
      type: DatasetType.TEXT,
      data: 'third'
    });
    expect(component.results).toEqual([]);
    expect(component.updateParagraphResult).not.toHaveBeenCalled();
    component.setResults(component.paragraph!);
    beginOutput(component);
    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\n' }]);
    component.onParagraphUpdateOutput({
      noteId: 'note',
      paragraphId: 'A',
      index: 1,
      type: DatasetType.TABLE,
      data: 'second'
    });
    expect(component.results).toEqual([
      { type: DatasetType.TEXT, data: 'first\n' },
      { type: DatasetType.TABLE, data: 'second' },
      { type: DatasetType.TEXT, data: 'third tail' }
    ]);
    expect(component.updateParagraphResult).toHaveBeenCalledWith(2, expect.anything(), {
      type: DatasetType.TEXT,
      data: 'third tail'
    });
    component.onParagraphAppendOutput({ noteId: 'note', paragraphId: 'A', index: 2, data: ' end' });
    expect(component.results[2].data).toBe('third tail end');
    component.ngOnDestroy();
  });
});

describe('ParagraphBase empty live result slots', () => {
  it('hides emptied higher slots when two tables are replaced with one text result in the same run', () => {
    const component = new TestParagraph(paragraph('A'));
    for (const index of [0, 1]) {
      component.onParagraphUpdateOutput({
        noteId: 'note',
        paragraphId: 'A',
        index,
        type: DatasetType.TABLE,
        data: 'old'
      });
      component.onParagraphUpdateOutput({ noteId: 'note', paragraphId: 'A', index, type: DatasetType.TABLE, data: '' });
    }
    component.onParagraphUpdateOutput({
      noteId: 'note',
      paragraphId: 'A',
      index: 0,
      type: DatasetType.TEXT,
      data: 'new'
    });
    expect(component.results).toEqual([
      { type: DatasetType.TEXT, data: 'new' },
      { type: DatasetType.TABLE, data: '' }
    ]);
    expect(component.isResultHidden(0)).toBe(false);
    expect(component.isResultHidden(1)).toBe(true);
    component.onParagraphAppendOutput({ noteId: 'note', paragraphId: 'A', index: 1, data: 'resumed' });
    expect(component.isResultHidden(1)).toBe(false);
    expect(component.results[1]).toEqual({ type: DatasetType.TABLE, data: 'resumed' });
    component.ngOnDestroy();
  });

  it('shows an intentionally empty result in the terminal snapshot', () => {
    const component = new TestParagraph(paragraph('A'));
    component.onParagraphUpdateOutput({
      noteId: 'note',
      paragraphId: 'A',
      index: 0,
      type: DatasetType.TABLE,
      data: ''
    });
    expect(component.isResultHidden(0)).toBe(true);
    component.paragraphData({
      paragraph: { ...paragraph('A', 'FINISHED'), results: { msg: [{ type: DatasetType.TABLE, data: '' }] } }
    });
    expect(component.isResultHidden(0)).toBe(false);
    component.ngOnDestroy();
  });
});
