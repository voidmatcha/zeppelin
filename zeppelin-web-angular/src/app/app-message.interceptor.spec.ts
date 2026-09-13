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

import { Router } from '@angular/router';

import { NzModalService } from 'ng-zorro-antd/modal';
import { NzNotificationService } from 'ng-zorro-antd/notification';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageReceiveDataTypeMap, OP, WebSocketMessage } from '@zeppelin/sdk';
import { TicketService } from '@zeppelin/services';

import { AppMessageInterceptor } from './app-message.interceptor';

describe('AppMessageInterceptor host-owned messages', () => {
  const navigate = vi.fn(() => Promise.resolve(true));
  const confirm = vi.fn();
  const create = vi.fn();
  const warning = vi.fn();
  const ticket = { init: true, principal: 'reader', roles: '["reader"]', ticket: 'ticket-a' };
  let interceptor: AppMessageInterceptor;

  const receive = (message: unknown) => interceptor.received(message as WebSocketMessage<MessageReceiveDataTypeMap>);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(ticket, { init: true, principal: 'reader', roles: '["reader"]', ticket: 'ticket-a' });
    interceptor = new AppMessageInterceptor(
      { navigate } as unknown as Router,
      { warning } as unknown as NzNotificationService,
      { ticket } as unknown as TicketService,
      { confirm, create } as unknown as NzModalService
    );
  });

  it('presents anonymous AUTH_INFO with the sign-in action owned by the host', () => {
    ticket.roles = '[]';
    const message = { op: OP.AUTH_INFO, data: { info: 'Insufficient privileges to read note.' } };

    expect(receive(message)).toBe(message);

    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        nzTitle: 'Insufficient privileges',
        nzContent: 'Insufficient privileges to read note.'
      })
    );
    expect(create).not.toHaveBeenCalled();
    expect(ticket.ticket).toBe('ticket-a');
  });

  it('presents AUTH_INFO without changing authentication state or consuming its msgId', () => {
    const before = { ...ticket };
    const message = {
      op: OP.AUTH_INFO,
      data: { info: 'Insufficient privileges to write note.' },
      msgId: 'optimistic-command-1'
    };

    expect(receive(message)).toBe(message);

    expect(create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        nzTitle: 'Insufficient privileges',
        nzContent: 'Insufficient privileges to write note.'
      })
    );
    expect(ticket).toEqual(before);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('presents global ERROR_INFO through the shell notification', () => {
    const message = { op: OP.ERROR_INFO, data: { info: 'Notebook command failed' } };

    expect(receive(message)).toBe(message);

    expect(warning).toHaveBeenCalledExactlyOnceWith(
      'ERROR',
      'Notebook command failed',
      expect.objectContaining({ nzStyle: expect.any(Object) })
    );
    expect(create).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('leaves SESSION_LOGOUT unhandled in the New UI shell', () => {
    const before = { ...ticket };
    const message = {
      op: OP.SESSION_LOGOUT,
      data: { info: 'Your ticket is invalid possibly due to server restart. Please login again.' }
    };

    expect(receive(message)).toBe(message);

    expect(ticket).toEqual(before);
    expect(navigate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });
});
