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

import { describe, expect, it, vi } from 'vitest';

import { MessageInterceptor } from '@zeppelin/interfaces';
import { OP, WebSocketMessage, MessageReceiveDataTypeMap } from '@zeppelin/sdk';
import { BaseUrlService } from './base-url.service';
import { MessageService } from './message.service';
import { TicketService } from './ticket.service';

const connectedMessageService = (): MessageService => {
  const service = new MessageService({} as BaseUrlService, {} as TicketService, null as unknown as MessageInterceptor);
  (service as unknown as { ws: { next: () => void; complete: () => void } }).ws = {
    next: vi.fn(),
    complete: vi.fn()
  };
  return service;
};

describe('MessageService local add focus', () => {
  it.each([
    ['insertParagraph', (service: MessageService) => service.insertParagraph(0)],
    ['copyParagraph', (service: MessageService) => service.copyParagraph(1, undefined, 'text', {}, {})]
  ])('records the msgId returned by %s once', (_method, add) => {
    const service = connectedMessageService();

    const msgId = add(service);

    expect(service.consumeLocalAddFocusMsgId(msgId)).toBe(true);
    expect(service.consumeLocalAddFocusMsgId(msgId)).toBe(false);
  });

  it('does not record a msgId for a paragraph added by another client', () => {
    const service = connectedMessageService();
    service.insertParagraph(0);

    expect(service.consumeLocalAddFocusMsgId('other-client-1')).toBe(false);
  });
});

describe('MessageService private notebook reads', () => {
  it('keeps Core save replies and failures out of legacy listeners', () => {
    const interceptor = { received: vi.fn(message => message) };
    const service = new MessageService({} as BaseUrlService, {} as TicketService, interceptor);
    (service as unknown as { ws: { next: () => void; complete: () => void } }).ws = {
      next: vi.fn(),
      complete: vi.fn()
    };
    const msgId = service.sendNotebookCoreCommit(() => undefined, OP.COMMIT_PARAGRAPH, {
      id: 'p1',
      noteId: 'a',
      paragraph: 'edited',
      config: {},
      params: {}
    });
    const raw = vi.fn();
    const legacy = vi.fn();
    service.received().subscribe(raw);
    service.receiveEnvelope(OP.PARAGRAPH).subscribe(legacy);

    const reply = {
      op: OP.PARAGRAPH,
      msgId,
      data: { noteId: 'a', paragraph: { id: 'p1', text: 'edited', status: 'READY' } }
    } as WebSocketMessage<MessageReceiveDataTypeMap>;
    service.shortCircuit(reply);
    service.interceptReceived({ op: OP.ERROR_INFO, msgId, data: { info: 'Denied' } });

    expect(raw).toHaveBeenCalledExactlyOnceWith(reply);
    expect(legacy).not.toHaveBeenCalled();
    expect(interceptor.received).toHaveBeenCalledExactlyOnceWith(reply);
    service.ngOnDestroy();
  });

  it('delivers private replies to the Core host without updating legacy notebook listeners', () => {
    const service = connectedMessageService();
    const requestId = service.sendNotebookCoreRead(() => undefined, OP.GET_NOTE, { id: 'a' });
    const lateRequestId = service.sendNotebookCoreRead(() => undefined, OP.GET_NOTE, { id: 'old-route' });
    const raw = vi.fn();
    const typed = vi.fn();
    const envelope = vi.fn();
    const coreSubscription = service.received().subscribe(raw);
    service.receive(OP.NOTE).subscribe(typed);
    service.receiveEnvelope(OP.NOTE).subscribe(envelope);

    const privateReply = {
      op: OP.NOTE,
      msgId: requestId,
      data: { id: 'a' }
    } as WebSocketMessage<MessageReceiveDataTypeMap>;
    const ordinaryReply = {
      op: OP.NOTE,
      msgId: 'ordinary-1',
      data: { id: 'b' }
    } as WebSocketMessage<MessageReceiveDataTypeMap>;
    service.shortCircuit(privateReply);
    coreSubscription.unsubscribe();
    service.shortCircuit({
      op: OP.NOTE,
      msgId: lateRequestId,
      data: { id: 'old-route' }
    } as WebSocketMessage<MessageReceiveDataTypeMap>);
    service.shortCircuit(ordinaryReply);

    expect(raw).toHaveBeenCalledExactlyOnceWith(privateReply);
    expect(typed).toHaveBeenCalledExactlyOnceWith(ordinaryReply.data);
    expect(envelope).toHaveBeenCalledExactlyOnceWith(ordinaryReply);
    service.ngOnDestroy();
  });

  it('keeps a delayed correlated read failure out of the global interceptor', () => {
    const interceptor = { received: vi.fn(message => message) };
    const service = new MessageService({} as BaseUrlService, {} as TicketService, interceptor);
    (service as unknown as { ws: { next: () => void; complete: () => void } }).ws = {
      next: vi.fn(),
      complete: vi.fn()
    };
    const requestId = service.sendNotebookCoreRead(() => undefined, OP.GET_NOTE, { id: 'a' });

    service.interceptReceived({ op: OP.AUTH_INFO, msgId: requestId, data: { info: 'Denied' } });
    service.interceptReceived({ op: OP.ERROR_INFO, msgId: requestId, data: { info: 'Late failure' } });
    service.interceptReceived({ op: OP.ERROR_INFO, msgId: 'ordinary-1', data: { info: 'Other failure' } });
    service.interceptReceived({ op: OP.SESSION_LOGOUT, data: {} });

    expect(interceptor.received).toHaveBeenCalledTimes(2);
    expect(interceptor.received.mock.calls.map(([message]) => message.op)).toEqual([OP.ERROR_INFO, OP.SESSION_LOGOUT]);
    service.ngOnDestroy();
  });
});
