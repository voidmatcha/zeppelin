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

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageReceiveDataTypeMap, OP, WebSocketMessage } from '@zeppelin/sdk';

import { BaseUrlService } from './base-url.service';
import { MessageService } from './message.service';
import { TicketService } from './ticket.service';

describe('MessageService notebook-scoped replies', () => {
  let service: MessageService;
  let ws: { next: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MessageService,
        { provide: BaseUrlService, useValue: { getWebsocketUrl: () => 'ws://localhost/ws' } },
        {
          provide: TicketService,
          useValue: {
            originTicket: { principal: 'anonymous', ticket: 'ticket', roles: '[]' }
          }
        }
      ]
    });
    service = TestBed.inject(MessageService);
    service.setWsUrl('ws://localhost/ws');
    service.setTicket({ principal: 'anonymous', ticket: 'ticket', roles: '[]' });
    ws = { next: vi.fn(), complete: vi.fn() };
    (service as unknown as { ws: typeof ws }).ws = ws;
  });

  it('returns a narrow non-secret send receipt', () => {
    const receipt = service.send(OP.PING);

    expect(receipt).toEqual({ op: OP.PING, msgId: expect.any(String) });
    expect(receipt).not.toHaveProperty('ticket');
    expect(receipt).not.toHaveProperty('principal');
    expect(receipt).not.toHaveProperty('roles');
    expect(lastSent()).toMatchObject({ op: OP.PING, ticket: 'ticket', principal: 'anonymous', roles: '[]' });
  });

  it('rejects replies without a request id', () => {
    expect(service.isCurrentNotebookReply(reply(OP.INTERPRETER_BINDINGS), OP.INTERPRETER_BINDINGS, 'note-a')).toBe(
      false
    );
  });

  it('rejects unknown request ids', () => {
    expect(
      service.isCurrentNotebookReply(reply(OP.INTERPRETER_BINDINGS, 'unknown'), OP.INTERPRETER_BINDINGS, 'note-a')
    ).toBe(false);
  });

  it('rejects late replies for a previous active note', () => {
    service.getInterpreterBindings('note-a');
    const request = lastSent();

    expect(
      service.isCurrentNotebookReply(reply(OP.INTERPRETER_BINDINGS, request.msgId), OP.INTERPRETER_BINDINGS, 'note-b')
    ).toBe(false);
  });

  it('accepts the same-note interpreter bindings reply once', () => {
    service.getInterpreterBindings('note-a');
    const request = lastSent();
    const envelope = reply(OP.INTERPRETER_BINDINGS, request.msgId);

    expect(service.isCurrentNotebookReply(envelope, OP.INTERPRETER_BINDINGS, 'note-a')).toBe(true);
    expect(service.isCurrentNotebookReply(envelope, OP.INTERPRETER_BINDINGS, 'note-a')).toBe(false);
  });

  it('keeps a pending request after a wrong-op envelope and accepts the valid reply', () => {
    service.listRevisionHistory('note-a');
    const request = lastSent();

    expect(
      service.isCurrentNotebookReply(reply(OP.INTERPRETER_BINDINGS, request.msgId), OP.INTERPRETER_BINDINGS, 'note-a')
    ).toBe(false);
    expect(
      service.isCurrentNotebookReply(reply(OP.LIST_REVISION_HISTORY, request.msgId), OP.LIST_REVISION_HISTORY, 'note-a')
    ).toBe(true);
  });

  it('tracks save-interpreter-bindings replies as notebook-scoped interpreter binding replies', () => {
    service.saveInterpreterBindings('note-a', ['md']);
    const request = lastSent();

    expect(
      service.isCurrentNotebookReply(reply(OP.INTERPRETER_BINDINGS, request.msgId), OP.INTERPRETER_BINDINGS, 'note-a')
    ).toBe(true);
  });

  it('distinguishes two outstanding requests with the same response op', () => {
    service.listRevisionHistory('note-a');
    const first = lastSent();
    service.checkpointNote('note-b', 'commit');
    const second = lastSent();

    expect(
      service.isCurrentNotebookReply(reply(OP.LIST_REVISION_HISTORY, first.msgId), OP.LIST_REVISION_HISTORY, 'note-b')
    ).toBe(false);
    expect(
      service.isCurrentNotebookReply(reply(OP.LIST_REVISION_HISTORY, second.msgId), OP.LIST_REVISION_HISTORY, 'note-b')
    ).toBe(true);
  });

  it('accepts same-note set revision replies', () => {
    service.setNoteRevision('note-a', 'revision-1');
    const request = lastSent();

    expect(
      service.isCurrentNotebookReply(reply(OP.SET_NOTE_REVISION, request.msgId), OP.SET_NOTE_REVISION, 'note-a')
    ).toBe(true);
  });

  it('accepts note revision replies only for the requested note and revision', () => {
    service.activateNotebookRoute('note-a', 'revision-1');
    service.noteRevision('note-a', 'revision-1');
    const request = lastSent();

    expect(
      service.isCurrentNotebookReply(
        reply(OP.NOTE_REVISION, request.msgId, { noteId: 'note-a', revisionId: 'revision-2' }),
        OP.NOTE_REVISION,
        'note-a',
        'revision-2'
      )
    ).toBe(false);
    expect(
      service.isCurrentNotebookReply(
        reply(OP.NOTE_REVISION, request.msgId, { noteId: 'note-b', revisionId: 'revision-1' }),
        OP.NOTE_REVISION,
        'note-a',
        'revision-1'
      )
    ).toBe(false);
    expect(
      service.isCurrentNotebookReply(
        reply(OP.NOTE_REVISION, request.msgId, { noteId: 'note-a', revisionId: 'revision-1' }),
        OP.NOTE_REVISION,
        'note-a',
        'revision-1'
      )
    ).toBe(true);
  });

  it('rejects note revision replies without matching route context data', () => {
    service.activateNotebookRoute('note-a', 'revision-1');
    service.noteRevision('note-a', 'revision-1');
    const request = lastSent();

    expect(
      service.isCurrentNotebookReply(reply(OP.NOTE_REVISION, request.msgId), OP.NOTE_REVISION, 'note-a', 'revision-1')
    ).toBe(false);
  });

  it('rejects a note A revision reply that arrives after route changes and reactivation', () => {
    service.activateNotebookRoute('note-a', 'revision-1');
    service.noteRevision('note-a', 'revision-1');
    const request = lastSent();

    service.activateNotebookRoute('note-b');
    service.activateNotebookRoute('note-a', 'revision-1');

    expect(
      service.isCurrentNotebookReply(
        reply(OP.NOTE_REVISION, request.msgId, { noteId: 'note-a', revisionId: 'revision-1' }),
        OP.NOTE_REVISION,
        'note-a',
        'revision-1'
      )
    ).toBe(false);
  });

  it('rejects a revision reply after the notebook route is destroyed and reopened', () => {
    service.activateNotebookRoute('note-a', 'revision-1');
    service.noteRevision('note-a', 'revision-1');
    const request = lastSent();

    service.deactivateNotebookRoute();
    service.activateNotebookRoute('note-a', 'revision-1');

    expect(
      service.isCurrentNotebookReply(
        reply(OP.NOTE_REVISION, request.msgId, { noteId: 'note-a', revisionId: 'revision-1' }),
        OP.NOTE_REVISION,
        'note-a',
        'revision-1'
      )
    ).toBe(false);
  });

  it('settles matching auth failures without accepting a later success reply', () => {
    service.getInterpreterBindings('note-a');
    const request = lastSent();

    expect(service.settleNotebookScopedFailure(reply(OP.AUTH_INFO, request.msgId), 'note-a')).toBe(true);
    expect(
      service.isCurrentNotebookReply(reply(OP.INTERPRETER_BINDINGS, request.msgId), OP.INTERPRETER_BINDINGS, 'note-a')
    ).toBe(false);
  });

  it('settles matching error failures without accepting a later success reply', () => {
    service.setNoteRevision('note-a', 'revision-1');
    const request = lastSent();

    expect(service.settleNotebookScopedFailure(reply(OP.ERROR_INFO, request.msgId), 'note-a')).toBe(true);
    expect(
      service.isCurrentNotebookReply(reply(OP.SET_NOTE_REVISION, request.msgId), OP.SET_NOTE_REVISION, 'note-a')
    ).toBe(false);
  });

  it('does not settle missing, unknown, or stale failure envelopes', () => {
    service.checkpointNote('note-a', 'commit');
    const request = lastSent();

    expect(service.settleNotebookScopedFailure(reply(OP.ERROR_INFO), 'note-a')).toBe(false);
    expect(service.settleNotebookScopedFailure(reply(OP.ERROR_INFO, 'unknown'), 'note-a')).toBe(false);
    expect(service.settleNotebookScopedFailure(reply(OP.ERROR_INFO, request.msgId), 'note-b')).toBe(false);
    expect(
      service.isCurrentNotebookReply(reply(OP.LIST_REVISION_HISTORY, request.msgId), OP.LIST_REVISION_HISTORY, 'note-a')
    ).toBe(true);
  });

  const lastSent = () => {
    return ws.next.mock.calls.at(-1)?.[0] as { msgId: string };
  };
});

const reply = <K extends keyof MessageReceiveDataTypeMap>(
  op: K,
  msgId?: string,
  data: Partial<MessageReceiveDataTypeMap[K]> = {}
): WebSocketMessage<MessageReceiveDataTypeMap, K> => ({
  op,
  msgId,
  data: data as MessageReceiveDataTypeMap[K]
});
