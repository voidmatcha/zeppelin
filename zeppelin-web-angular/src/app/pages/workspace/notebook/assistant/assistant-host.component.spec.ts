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

import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OP } from '@zeppelin/sdk';
import { BaseUrlService, MessageService, TicketService } from '@zeppelin/services';
import { AssistantHostComponent } from './assistant-host.component';
import { AssistantSlots } from './assistant-slots';

describe('AssistantHostComponent assistant panel', () => {
  let component: AssistantHostComponent;
  let logout: ReturnType<typeof vi.fn>;
  let entry: AssistantSlots;
  let socketSend: ReturnType<typeof vi.fn>;
  let socketEvents: Subject<unknown>;
  const props = () =>
    component.assistantProps as unknown as {
      apiBase: string;
      onAuthError(status: number, location: string | null): void;
      onError(error: unknown): void;
    };

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    logout = vi.fn(() => new Subject<void>());
    entry = new AssistantSlots();
    socketSend = vi.fn();
    socketEvents = new Subject();
    const ticket = new TicketService(
      {} as HttpClient,
      { getRestApiBase: () => 'https://example.test/zeppelin/api' } as BaseUrlService,
      {} as Router,
      {} as NzMessageService
    );
    ticket.ticket.principal = 'assistant-user';
    // The real auth-failure policy, with only the logout request stubbed.
    vi.spyOn(ticket, 'logout').mockImplementation(logout);
    component = new AssistantHostComponent(
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      { getRestApiBase: () => 'https://example.test/zeppelin/api' } as unknown as BaseUrlService,
      ticket,
      entry,
      { send: socketSend, receive: vi.fn(() => socketEvents) } as unknown as MessageService
    );
    component.note = { id: 'note', paragraphs: [] } as never;
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
    vi.restoreAllMocks();
  });

  it('mounts only while the notebook enables the React assistant', () => {
    expect(component.assistantProps.draftOwner).toBe('assistant-user');
    expect(component.useAssistantPanel).toBe(false);
    component.enabled = true;
    expect(component.useAssistantPanel).toBe(true);
    const props = component.assistantProps;
    component.enabled = false;
    expect(component.useAssistantPanel).toBe(false);
    expect(component.assistantProps).not.toBe(props);
  });

  it('publishes explicit slots to the remote and drops removed ones', async () => {
    const element = document.createElement('div');
    entry.set({ element, kind: 'panel' });
    await Promise.resolve();
    expect(component.assistantProps.slots).toEqual([{ element, kind: 'panel' }]);
    entry.remove(element);
    await Promise.resolve();
    expect(component.assistantProps.slots).toEqual([]);
  });

  it('memoizes props by note id and forwards the error callback', () => {
    component.note = { id: 'note-1' } as AssistantHostComponent['note'];
    const props = component.assistantProps;
    expect(props).toMatchObject({ noteId: 'note-1', onError: expect.any(Function) });
    expect(component.assistantProps).toBe(props);
    component.note = { id: 'note-2' } as AssistantHostComponent['note'];
    expect(component.assistantProps).not.toBe(props);
    expect(component.assistantProps.noteId).toBe('note-2');
  });

  it('passes the REST base so the remote can call the conversation API', () => {
    expect(props()).toMatchObject({ noteId: 'note', apiBase: 'https://example.test/zeppelin/api' });
  });

  it('sends assistant messages over the notebook socket only for the current note', () => {
    const socket = component.assistantProps.socket as {
      send(message: object): void;
      subscribe(listener: (event: unknown) => void): () => void;
    };
    const message = { noteId: 'note', conversationId: 'c1', content: 'hi' };

    socket.send(message);
    expect(socketSend).toHaveBeenCalledWith(OP.ASSISTANT_SEND_MESSAGE, message);

    component.note = { id: 'other-note', paragraphs: [] } as never;
    expect(() => socket.send(message)).toThrow('Notebook changed');
    expect(socketSend).toHaveBeenCalledTimes(1);
  });

  it('forwards assistant events until the remote unsubscribes', () => {
    const socket = component.assistantProps.socket as { subscribe(listener: (event: unknown) => void): () => void };
    const listener = vi.fn();
    const unsubscribe = socket.subscribe(listener);
    socketEvents.next({ conversationId: 'c1', type: 'run.started' });
    unsubscribe();
    socketEvents.next({ conversationId: 'c1', type: 'run.completed' });
    expect(listener.mock.calls).toEqual([[{ conversationId: 'c1', type: 'run.started' }]]);
  });

  it('records remote failure for the host fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    component.onAssistantError(new Error('remote unavailable'));
    expect(component.assistantPanelFailed).toBe(true);
  });

  it('deduplicates logout and ignores callbacks from a previous note', () => {
    component.note = { id: 'old' } as AssistantHostComponent['note'];
    const old = props();
    old.onAuthError(405, null);
    old.onAuthError(405, null);
    expect(logout).toHaveBeenCalledTimes(1);
    component.note = { id: 'new' } as AssistantHostComponent['note'];
    old.onError(new Error('stale'));
    expect(component.assistantPanelFailed).toBe(false);
  });

  it('retries a failed remote when the flag is turned back on', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    component.enabled = true;
    component.onAssistantError(new Error('remote unavailable'));
    component.enabled = false;
    component.enabled = true;
    expect(component.assistantPanelFailed).toBe(false);
  });
  it('redirects only a 401 with Location and leaves other statuses alone', () => {
    const originalHash = window.location.hash;
    props().onAuthError(401, null);
    props().onAuthError(500, '#ignored');
    expect(window.location.hash).toBe(originalHash);
    props().onAuthError(401, '#assistant-login');
    expect(window.location.hash).toBe('#assistant-login');
    expect(logout).not.toHaveBeenCalled();
    window.location.hash = originalHash;
  });
});
