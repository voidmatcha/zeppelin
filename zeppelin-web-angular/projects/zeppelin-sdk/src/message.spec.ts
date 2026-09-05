/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
<<<<<<< HEAD
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { webSocket } = vi.hoisted(() => ({ webSocket: vi.fn() }));

vi.mock('rxjs/webSocket', () => ({ webSocket }));

import type { MessageReceiveDataTypeMap } from './interfaces/message-data-type-map.interface';
import { OP } from './interfaces/message-operator.interface';
import type { WebSocketMessage } from './interfaces/websocket-message.interface';
import { Message } from './message';

const asReceivedMessage = (message: unknown): WebSocketMessage<MessageReceiveDataTypeMap> =>
  message as WebSocketMessage<MessageReceiveDataTypeMap>;

type SocketConfig = Readonly<{
  closeObserver?: Readonly<{ next: (event: CloseEvent) => void }>;
}>;

const createSocket = () => ({
  complete: vi.fn(),
  next: vi.fn(),
  subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Message.receive', () => {
  it('passes a non-removal job update with noteName', () => {
    const message = new Message();
    const listener = vi.fn();
    const data = {
      noteRunningJobs: {
        jobs: [
          {
            noteId: 'note-1',
            noteName: 'Test Note',
            isRemoved: false
          }
        ]
      }
    };

    message.receive(OP.LIST_UPDATE_NOTE_JOBS).subscribe(listener);

    message.shortCircuit(
      asReceivedMessage({
        op: OP.LIST_UPDATE_NOTE_JOBS,
        data
      })
    );

    expect(listener).toHaveBeenCalledWith(data);
  });

  it('passes a partial removal payload without noteName', () => {
    const message = new Message();
    const listener = vi.fn();
    const data = {
      noteRunningJobs: {
        jobs: [
          {
            noteId: 'note-1',
            isRemoved: true
          }
        ]
      }
    };

    message.receive(OP.LIST_UPDATE_NOTE_JOBS).subscribe(listener);

    message.shortCircuit(
      asReceivedMessage({
        op: OP.LIST_UPDATE_NOTE_JOBS,
        data
      })
    );

    expect(listener).toHaveBeenCalledWith(data);
  });

  it('filters a non-removal job update without noteName and warns with the OP only', () => {
    const message = new Message();
    const listener = vi.fn();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    message.receive(OP.LIST_UPDATE_NOTE_JOBS).subscribe(listener);

    message.shortCircuit(
      asReceivedMessage({
        op: OP.LIST_UPDATE_NOTE_JOBS,
        data: {
          noteRunningJobs: {
            jobs: [
              {
                noteId: 'note-1',
                isRemoved: false
              }
            ]
          }
        }
      })
    );

    expect(listener).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      `Dropped WebSocket OP ${String(OP.LIST_UPDATE_NOTE_JOBS)}: payload failed validation`
    );
  });

  it('filters a payload without a jobs array', () => {
    const message = new Message();
    const listener = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    message.receive(OP.LIST_UPDATE_NOTE_JOBS).subscribe(listener);

    message.shortCircuit(
      asReceivedMessage({
        op: OP.LIST_UPDATE_NOTE_JOBS,
        data: {
          noteRunningJobs: {}
        }
      })
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps existing behavior for an OP without a guard', () => {
    const message = new Message();
    const listener = vi.fn();
    const data = {};

    message.receive(OP.NOTE).subscribe(listener);

    message.shortCircuit(
      asReceivedMessage({
        op: OP.NOTE,
        data
      })
    );

    expect(listener).toHaveBeenCalledWith(data);
||||||| parent of 8f4763c72 ([ZEPPELIN-6696] Serialize WebSocket reconnects)
=======
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { webSocket } = vi.hoisted(() => ({ webSocket: vi.fn() }));

vi.mock('rxjs/webSocket', () => ({ webSocket }));

import { Message } from './message';

type SocketConfig = Readonly<{
  closeObserver?: Readonly<{ next: (event: CloseEvent) => void }>;
  openObserver?: Readonly<{ next: (event: Event) => void }>;
}>;

const createSocket = () => ({
  complete: vi.fn(),
  next: vi.fn(),
  subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
});

describe('Message reconnect lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    webSocket.mockReset();
  });

  it('schedules exactly one reconnect after repeated unexpected close signals', () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    webSocket.mockReturnValueOnce(firstSocket).mockReturnValueOnce(secondSocket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');

    message.connect();
    const firstConfig = webSocket.mock.calls[0][0] as SocketConfig;
    firstConfig.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    firstConfig.closeObserver?.next(new CloseEvent('close', { code: 1006 }));

    vi.advanceTimersByTime(999);
    expect(webSocket).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(webSocket).toHaveBeenCalledTimes(2);
    expect(firstSocket.complete).toHaveBeenCalledOnce();
  });

  it('cancels pending reconnects on a terminal destroy', () => {
    const socket = createSocket();
    webSocket.mockReturnValue(socket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');
    message.connect();
    const config = webSocket.mock.calls[0][0] as SocketConfig;

    config.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    message.destroy();
    vi.advanceTimersByTime(30000);

    expect(webSocket).toHaveBeenCalledOnce();
    expect(socket.complete).toHaveBeenCalledOnce();
  });

  it('closes the physical socket without scheduling another connection', () => {
    const socket = createSocket();
    webSocket.mockReturnValue(socket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');
    message.connect();
    const config = webSocket.mock.calls[0][0] as SocketConfig;

    message.close();
    config.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    vi.advanceTimersByTime(30000);

    expect(socket.complete).toHaveBeenCalledOnce();
    expect(webSocket).toHaveBeenCalledOnce();
  });

  it('ignores a close callback from a socket superseded by a direct reconnect', () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    webSocket.mockReturnValueOnce(firstSocket).mockReturnValueOnce(secondSocket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');

    message.connect();
    const firstConfig = webSocket.mock.calls[0][0] as SocketConfig;
    message.connect();
    firstConfig.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    vi.advanceTimersByTime(30000);

    expect(webSocket).toHaveBeenCalledTimes(2);
  });
});

describe('Message reconnect lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    webSocket.mockReset();
  });

  it('schedules exactly one reconnect after repeated unexpected close signals', () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    webSocket.mockReturnValueOnce(firstSocket).mockReturnValueOnce(secondSocket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');

    message.connect();
    const firstConfig = webSocket.mock.calls[0][0] as SocketConfig;
    firstConfig.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    firstConfig.closeObserver?.next(new CloseEvent('close', { code: 1006 }));

    vi.advanceTimersByTime(999);
    expect(webSocket).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(webSocket).toHaveBeenCalledTimes(2);
    expect(firstSocket.complete).toHaveBeenCalledOnce();
  });

  it('cancels pending reconnects on a terminal destroy', () => {
    const socket = createSocket();
    webSocket.mockReturnValue(socket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');
    message.connect();
    const config = webSocket.mock.calls[0][0] as SocketConfig;

    config.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    message.destroy();
    vi.advanceTimersByTime(30000);

    expect(webSocket).toHaveBeenCalledOnce();
    expect(socket.complete).toHaveBeenCalledOnce();
  });

  it('closes the physical socket without scheduling another connection', () => {
    const socket = createSocket();
    webSocket.mockReturnValue(socket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');
    message.connect();
    const config = webSocket.mock.calls[0][0] as SocketConfig;

    message.close();
    config.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    vi.advanceTimersByTime(30000);

    expect(socket.complete).toHaveBeenCalledOnce();
    expect(webSocket).toHaveBeenCalledOnce();
  });

  it('ignores a close callback from a socket superseded by a direct reconnect', () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    webSocket.mockReturnValueOnce(firstSocket).mockReturnValueOnce(secondSocket);
    const message = new Message();
    message.setWsUrl('ws://example.test/ws');

    message.connect();
    const firstConfig = webSocket.mock.calls[0][0] as SocketConfig;
    message.connect();
    firstConfig.closeObserver?.next(new CloseEvent('close', { code: 1006 }));
    vi.advanceTimersByTime(30000);

    expect(webSocket).toHaveBeenCalledTimes(2);
>>>>>>> 8f4763c72 ([ZEPPELIN-6696] Serialize WebSocket reconnects)
  });
});
