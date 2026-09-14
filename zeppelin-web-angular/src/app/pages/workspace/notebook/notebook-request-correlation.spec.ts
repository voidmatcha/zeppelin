/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { OP } from '@zeppelin/sdk';
import { describe, expect, it } from 'vitest';

import { NotebookRequestCorrelation } from './notebook-request-correlation';

describe('NotebookRequestCorrelation', () => {
  it('accepts the matching response for the active note', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.record({ op: OP.GET_INTERPRETER_BINDINGS, msgId: 'request-a', data: { noteId: 'note-a' } });

    expect(correlation.accept({ op: OP.INTERPRETER_BINDINGS, msgId: 'request-a' }, 'note-a')).toBe(true);
  });

  it('rejects missing, unknown, mismatched, and duplicate responses', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.record({ op: OP.LIST_REVISION_HISTORY, msgId: 'request-a', data: { noteId: 'note-a' } });

    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY }, 'note-a')).toBe(false);
    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'unknown' }, 'note-a')).toBe(false);
    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'request-a' }, 'note-b')).toBe(false);
    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'request-a' }, 'note-a')).toBe(true);
    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'request-a' }, 'note-a')).toBe(false);
  });

  it('allows a checkpoint to resolve through its revision-list response', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.record({
      op: OP.CHECKPOINT_NOTE,
      msgId: 'checkpoint-a',
      data: { noteId: 'note-a', commitMessage: 'save' }
    });

    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'checkpoint-a' }, 'note-a')).toBe(true);
  });

  it('keeps concurrent requests for the same response operation separate', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.record({ op: OP.LIST_REVISION_HISTORY, msgId: 'first', data: { noteId: 'note-a' } });
    correlation.record({ op: OP.LIST_REVISION_HISTORY, msgId: 'second', data: { noteId: 'note-a' } });

    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'second' }, 'note-a')).toBe(true);
    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'first' }, 'note-a')).toBe(true);
  });

  it('bounds unresolved requests so a long-lived notebook view does not retain them indefinitely', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    for (let index = 0; index <= 100; index += 1) {
      correlation.record({
        op: OP.GET_INTERPRETER_BINDINGS,
        msgId: `request-${index}`,
        data: { noteId: 'note-a' }
      });
    }

    expect(correlation.accept({ op: OP.INTERPRETER_BINDINGS, msgId: 'request-0' }, 'note-a')).toBe(false);
    expect(correlation.accept({ op: OP.INTERPRETER_BINDINGS, msgId: 'request-1' }, 'note-a')).toBe(true);
    expect(correlation.accept({ op: OP.INTERPRETER_BINDINGS, msgId: 'request-100' }, 'note-a')).toBe(true);
  });

  it('rejects a response recorded before an A to B to A route transition', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.record({ op: OP.LIST_REVISION_HISTORY, msgId: 'stale-a', data: { noteId: 'note-a' } });

    correlation.enterRoute('note-b', null);
    correlation.enterRoute('note-a', null);

    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'stale-a' }, 'note-a')).toBe(false);
  });

  it('rejects live-note responses after entering or leaving a revision route', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.record({ op: OP.LIST_REVISION_HISTORY, msgId: 'live', data: { noteId: 'note-a' } });

    correlation.enterRoute('note-a', 'revision-a');
    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'live' }, 'note-a')).toBe(false);

    correlation.record({ op: OP.LIST_REVISION_HISTORY, msgId: 'revision', data: { noteId: 'note-a' } });
    correlation.enterRoute('note-a', null);
    expect(correlation.accept({ op: OP.LIST_REVISION_HISTORY, msgId: 'revision' }, 'note-a')).toBe(false);
  });

  it('rejects responses from a previous WebSocket connection', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.connectionChanged(true);
    correlation.record({ op: OP.GET_INTERPRETER_BINDINGS, msgId: 'old-socket', data: { noteId: 'note-a' } });

    correlation.connectionChanged(false);
    correlation.connectionChanged(true);

    expect(correlation.accept({ op: OP.INTERPRETER_BINDINGS, msgId: 'old-socket' }, 'note-a')).toBe(false);
  });

  it('keeps pending requests when the combined route stream repeats the same connection state', () => {
    const correlation = new NotebookRequestCorrelation();
    correlation.enterRoute('note-a', null);
    correlation.connectionChanged(true);
    correlation.record({ op: OP.GET_INTERPRETER_BINDINGS, msgId: 'current', data: { noteId: 'note-a' } });

    correlation.connectionChanged(true);

    expect(correlation.accept({ op: OP.INTERPRETER_BINDINGS, msgId: 'current' }, 'note-a')).toBe(true);
  });
});
