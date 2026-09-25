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
  protected currentNoteId: string | null = 'note';

  constructor(
    paragraph: ParagraphItem,
    message: Message = { receive: () => EMPTY } as unknown as Message,
    spellService = { executeSpell: vi.fn() }
  ) {
    super(
      message,
      { isParagraphRunning: item => item.status === 'RUNNING', isEntireNoteRunning: () => false },
      {} as AngularContextManager,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      spellService
    );
    this.paragraph = paragraph;
  }

  hydrate(snapshot: ParagraphItem) {
    this.setParagraphSnapshot(snapshot);
  }

  detachFromNote() {
    this.currentNoteId = null;
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

describe('ParagraphBase Helium Spell execution', () => {
  it('publishes supported local Spell results through the server contract', async () => {
    const message = {
      receive: () => EMPTY,
      paragraphExecutedBySpell: vi.fn()
    } as unknown as Message;
    const executeSpell = vi.fn().mockResolvedValue([{ type: DatasetType.TEXT, data: 'rendered' }]);
    const component = new TestParagraph(paragraph('A', 'READY'), message, { executeSpell });

    await component.runParagraphUsingSpell('%demo   input', '%demo', false);

    expect(executeSpell).toHaveBeenCalledWith('%demo', 'input');
    expect(component.paragraph?.status).toBe('FINISHED');
    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'rendered' }]);
    expect(message.paragraphExecutedBySpell).toHaveBeenCalledWith(
      'A',
      '',
      '%demo   input',
      [{ type: DatasetType.TEXT, data: 'rendered' }],
      'FINISHED',
      '',
      expect.anything(),
      {},
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
    component.ngOnDestroy();
  });

  it('keeps an ELEMENT callback locally but propagates its source Spell text', async () => {
    const message = {
      receive: () => EMPTY,
      paragraphExecutedBySpell: vi.fn()
    } as unknown as Message;
    const callback = vi.fn();
    const executeSpell = vi
      .fn()
      .mockResolvedValue([{ type: 'ELEMENT', data: callback, magic: '%flowchart', text: 'start=>start' }]);
    const component = new TestParagraph(paragraph('A', 'READY'), message, { executeSpell });

    await component.runParagraphUsingSpell('%flowchart start=>start', '%flowchart', false);

    expect(component.results).toEqual([{ type: 'ELEMENT', data: callback, magic: '%flowchart', text: 'start=>start' }]);
    expect(component.paragraph?.results?.msg).toEqual([{ type: '%flowchart', data: 'start=>start' }]);
    expect(message.paragraphExecutedBySpell).toHaveBeenCalledWith(
      'A',
      '',
      '%flowchart start=>start',
      [{ type: '%flowchart', data: 'start=>start' }],
      'FINISHED',
      '',
      expect.anything(),
      {},
      expect.any(String),
      expect.any(String)
    );
    component.ngOnDestroy();
  });

  it('surfaces Spell failures and propagates an error snapshot', async () => {
    const message = {
      receive: () => EMPTY,
      paragraphExecutedBySpell: vi.fn()
    } as unknown as Message;
    const executeSpell = vi.fn().mockRejectedValue(new Error('spell failed'));
    const component = new TestParagraph(paragraph('A', 'READY'), message, { executeSpell });

    await component.runParagraphUsingSpell('%demo input', '%demo', false);

    expect(component.paragraph?.status).toBe('ERROR');
    expect(component.paragraph?.errorMessage).toContain('spell failed');
    expect(component.results).toEqual([]);
    expect(message.paragraphExecutedBySpell).toHaveBeenCalledWith(
      'A',
      '',
      '%demo input',
      [],
      'ERROR',
      expect.stringContaining('spell failed'),
      expect.anything(),
      {},
      expect.any(String),
      expect.any(String)
    );
    component.ngOnDestroy();
  });

  it('does not echo a propagated Spell execution back to the server', async () => {
    const message = {
      receive: () => EMPTY,
      paragraphExecutedBySpell: vi.fn()
    } as unknown as Message;
    const component = new TestParagraph(paragraph('A', 'READY'), message, {
      executeSpell: vi.fn().mockResolvedValue([{ type: DatasetType.HTML, data: '<b>ok</b>' }])
    });

    await component.runParagraphUsingSpell('%demo input', '%demo', true);

    expect(component.paragraph?.status).toBe('FINISHED');
    expect(message.paragraphExecutedBySpell).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('replays another client Spell execution without broadcasting it again', async () => {
    const message = {
      receive: () => EMPTY,
      paragraphExecutedBySpell: vi.fn()
    } as unknown as Message;
    const rendered = [{ type: DatasetType.HTML, data: '<b>remote</b>' }];
    const executeSpell = vi.fn().mockResolvedValue(rendered);
    const component = new TestParagraph(paragraph('A', 'READY'), message, { executeSpell });
    const remote = {
      ...paragraph('A', 'FINISHED', '2026-01-01T00:00:01Z'),
      text: '%demo remote input',
      dateFinished: '2026-01-01T00:00:02Z',
      errorMessage: '',
      results: { code: 'FINISHED', msg: rendered }
    };

    component.runParagraphUsingSpellFromRemote({ paragraph: remote });
    component.runParagraphUsingSpellFromRemote({ paragraph: remote });
    expect(executeSpell).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(component.paragraph?.status).toBe('FINISHED'));

    expect(executeSpell).toHaveBeenCalledOnce();
    expect(executeSpell).toHaveBeenCalledWith('%demo', 'remote input');
    expect(component.results).toEqual(rendered);
    expect(message.paragraphExecutedBySpell).not.toHaveBeenCalled();

    component.ngOnDestroy();
  });

  it('ignores collaborative Spell executions for another paragraph or a detached note', async () => {
    const executeSpell = vi.fn().mockResolvedValue([]);
    const component = new TestParagraph(paragraph('A', 'READY'), undefined, { executeSpell });
    const remote = { ...paragraph('B', 'FINISHED'), text: '%demo remote' };

    component.runParagraphUsingSpellFromRemote({ paragraph: remote });
    component.detachFromNote();
    component.runParagraphUsingSpellFromRemote({ paragraph: { ...remote, id: 'A' } });
    await Promise.resolve();

    expect(executeSpell).not.toHaveBeenCalled();
    expect(component.paragraph?.id).toBe('A');
    expect(component.paragraph?.status).toBe('READY');
    component.ngOnDestroy();
  });

  it('surfaces a malformed collaborative Spell execution instead of falling back to an interpreter', () => {
    const message = {
      receive: () => EMPTY,
      runParagraph: vi.fn(),
      paragraphExecutedBySpell: vi.fn()
    } as unknown as Message;
    const executeSpell = vi.fn();
    const component = new TestParagraph(paragraph('A', 'READY'), message, { executeSpell });
    const remote = { ...paragraph('A', 'FINISHED'), text: 'missing magic', dateFinished: 'later' };

    component.runParagraphUsingSpellFromRemote({ paragraph: remote });

    expect(component.paragraph?.status).toBe('ERROR');
    expect(component.paragraph?.errorMessage).toContain('without a valid magic prefix');
    expect(executeSpell).not.toHaveBeenCalled();
    expect(message.runParagraph).not.toHaveBeenCalled();
    expect(message.paragraphExecutedBySpell).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
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

  it('publishes the final result when terminal status arrives before its snapshot', () => {
    const component = new TestParagraph(paragraph('A'));
    beginOutput(component);
    component.onParagraphStatus({ id: 'A', status: 'FINISHED' });
    const finished = paragraph('A', 'FINISHED');
    delete finished.dateStarted;
    finished.results = { msg: [{ type: DatasetType.TEXT, data: 'first\nfinal\n' }] };

    component.paragraphData({ paragraph: finished });

    expect(component.results).toEqual([{ type: DatasetType.TEXT, data: 'first\nfinal\n' }]);
    expect(component.updateParagraphResult).toHaveBeenCalledWith(0, expect.anything(), {
      type: DatasetType.TEXT,
      data: 'first\nfinal\n'
    });
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
      { type: DatasetType.TEXT, data: 'third' }
    ]);
    expect(component.updateParagraphResult).toHaveBeenCalledWith(2, expect.anything(), {
      type: DatasetType.TEXT,
      data: 'third'
    });
    component.onParagraphAppendOutput({ noteId: 'note', paragraphId: 'A', index: 2, data: ' end' });
    expect(component.results[2].data).toBe('third end');
    component.ngOnDestroy();
  });
});
