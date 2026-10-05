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

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantEvent, AssistantSendMessage, AssistantSocketEvent } from '@zeppelin/sdk';

import {
  AssistantHttpError,
  AssistantStreamError,
  createAssistantTransport,
  mapSocketEvent,
  resetRunTracking,
  scopeTransport,
  socketRun,
  toVisibleMessages
} from './assistantTransport';

/** A host socket double: records sends and lets a test emit server events. */
const fakeSocket = () => {
  const listeners = new Set<(event: AssistantSocketEvent) => void>();
  const sent: AssistantSendMessage[] = [];
  return {
    sent,
    listenerCount: () => listeners.size,
    emit: (event: AssistantSocketEvent) => listeners.forEach(listener => listener(event)),
    send: vi.fn((message: AssistantSendMessage) => {
      sent.push(message);
    }),
    subscribe: vi.fn((listener: (event: AssistantSocketEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    })
  };
};

const forNote = (noteId: string, onAuthError?: (status: number, location: string | null) => void) =>
  createAssistantTransport('https://example.test/zeppelin/api', noteId, fakeSocket(), onAuthError);

const iterate = <T>(iterable: AsyncIterable<T>): AsyncIterator<T> => iterable[Symbol.asyncIterator]();

const collect = async (events: AsyncIterable<AssistantEvent>): Promise<AssistantEvent[]> => {
  const collected: AssistantEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

const message = (content = 'hi'): AssistantSendMessage => ({ noteId: 'n', conversationId: 'c1', content });

describe('assistant transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();

    // Run tracking is module state.
    resetRunTracking();
  });

  it('lists the most recently active conversation first and undated ones last', async () => {
    const body = [
      { id: 'old', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
      { id: 'undated' },
      { id: 'new', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' },
      { id: 'created-only', createdAt: '2026-10-02T00:00:00Z' }
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'OK', body }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const threads = await forNote('note-1').listThreads();
    expect(threads.map(thread => thread.id)).toEqual(['new', 'created-only', 'old', 'undated']);
  });

  it('uses the per-note conversation endpoints and unwraps Zeppelin JSON responses', async () => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          status: 'OK',
          body: [{ id: 'conv-1', title: 'First', noteId: 'note/one', canSendMessage: false }]
        })
      )
      .mockResolvedValueOnce(json({ status: 'OK', body: { id: 'conv-2', title: 'Load the data' } }))
      .mockResolvedValueOnce(
        json({
          status: 'OK',
          body: {
            messages: [
              { id: 'message-2', role: 'assistant', content: 'hi there' },
              { id: 'message-1', role: 'user', content: 'hello' }
            ],
            nextCursor: null
          }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = forNote('note/one');

    await expect(transport.listThreads()).resolves.toEqual([
      { id: 'conv-1', title: 'First', noteId: 'note/one', canSendMessage: false }
    ]);
    await expect(transport.createThread({ title: '  Load   the data  ' })).resolves.toEqual({
      id: 'conv-2',
      title: 'Load the data',
      noteId: 'note/one'
    });
    // The server pages latest first; the panel wants oldest first.
    await expect(transport.getMessages('conv/1')).resolves.toEqual({
      messages: [
        { id: 'message-1', role: 'user', content: 'hello' },
        { id: 'message-2', role: 'assistant', content: 'hi there' }
      ],
      earlierCursor: null
    });
    await expect(transport.deleteThread('conv/1')).resolves.toBeUndefined();

    const base = 'https://example.test/zeppelin/api/notes/note%2Fone/conversations';
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [base, 'GET'],
      [base, 'POST'],
      [`${base}/conv%2F1/messages?limit=50`, 'GET'],
      [`${base}/conv%2F1`, 'DELETE']
    ]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }),
      // The first question names the conversation, with whitespace collapsed.
      body: JSON.stringify({ title: 'Load the data' })
    });
  });

  it('words a 404 on the conversation list as a server without the assistant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const transport = forNote('n');

    await expect(transport.listThreads()).rejects.toThrow('The assistant is not available on this server');
    await expect(transport.createThread({})).rejects.toThrow('The assistant is not available on this server');
    await expect(transport.getMessages('c')).rejects.toThrow('This conversation or note no longer exists.');
  });

  it('hands 401 and 405 to the host, but not other failures', async () => {
    const onAuthError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401, headers: { Location: '/login' } }))
        .mockResolvedValueOnce(new Response(null, { status: 405 }))
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
    );
    const transport = forNote('n', onAuthError);

    await expect(transport.listThreads()).rejects.toMatchObject({ status: 401, location: '/login' });
    await expect(transport.createThread({})).rejects.toMatchObject({ status: 405 });
    await expect(transport.getMessages('c')).rejects.toBeInstanceOf(AssistantHttpError);

    expect(onAuthError.mock.calls).toEqual([
      [401, '/login'],
      [405, null]
    ]);
  });

  it('sends over the socket and yields only this conversation until a terminal event', async () => {
    const socket = fakeSocket();
    const transport = createAssistantTransport('https://example.test/api', 'n', socket);
    const run = iterate(transport.openRun('c1', { prompt: 'improve' }, new AbortController().signal));
    const first = run.next();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent[0]).toEqual({ noteId: 'n', conversationId: 'c1', content: 'improve' });

    socket.emit({ conversationId: 'other', type: 'message.delta', payload: { messageId: 'x', delta: 'no' } });
    socket.emit({ conversationId: 'c1', type: 'run.started', payload: { runId: 'run_1' } });
    socket.emit({
      conversationId: 'c1',
      type: 'tool_call.started',
      payload: { toolCallId: 't1', name: 'list_paragraphs' }
    });
    socket.emit({
      conversationId: 'c1',
      type: 'tool_call.done',
      payload: { toolCallId: 't1', result: { value: '[]' } }
    });
    socket.emit({ conversationId: 'c1', type: 'usage.extra', payload: {} });
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm1', delta: '한글' } });
    socket.emit({ conversationId: 'c1', type: 'run.completed', payload: { runId: 'run_1' } });
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm2', delta: 'late' } });

    const events = [(await first).value];
    for (let next = await run.next(); !next.done; next = await run.next()) events.push(next.value);
    expect(events).toEqual([
      { type: 'run.started', runId: 'run_1' },
      { type: 'tool_call.started', toolCallId: 't1', name: 'list_paragraphs' },
      { type: 'tool_call.done', toolCallId: 't1', name: undefined },
      { type: 'message.delta', messageId: 'm1', delta: '한글' },
      { type: 'run.completed', runId: 'run_1' }
    ]);
    expect(socket.listenerCount()).toBe(0);
  });

  it('ends on a run failure that arrives before run.started', async () => {
    const socket = fakeSocket();
    const pending = collect(socketRun(socket, message(), new AbortController().signal));
    socket.emit({
      conversationId: 'c1',
      type: 'run.failed',
      payload: { runId: 'run_x', error: { status: 403 } }
    });
    await expect(pending).resolves.toEqual([
      {
        type: 'run.failed',
        runId: 'run_x',
        message: 'You do not have permission to send messages to this conversation.'
      }
    ]);
  });

  it('leaves the events of a run another iterator still receives to that iterator', async () => {
    const socket = fakeSocket();
    const first = iterate(socketRun(socket, message('first'), new AbortController().signal));
    const started = first.next();
    socket.emit({ conversationId: 'c1', type: 'run.started', payload: { runId: 'run_a' } });
    expect((await started).value).toEqual({ type: 'run.started', runId: 'run_a' });

    // A second message while the first run still streams (the panel stopped waiting for it).
    const second = collect(socketRun(socket, message('second'), new AbortController().signal));
    socket.emit({ conversationId: 'c1', type: 'run.failed', payload: { runId: 'run_a', error: { status: 500 } } });
    socket.emit({ conversationId: 'c1', type: 'run.failed', payload: { runId: 'run_b', error: { status: 409 } } });
    await expect(second).resolves.toEqual([
      {
        type: 'run.failed',
        runId: 'run_b',
        message: 'This conversation is still answering. Try again when it finishes.'
      }
    ]);
    // The first run's own failure still reaches the first iterator.
    expect((await first.next()).value).toMatchObject({ type: 'run.failed', runId: 'run_a' });
  });

  it('keeps a stopped-waiting run streaming when a later message is rejected first', async () => {
    const socket = fakeSocket();
    const first = iterate(socketRun(socket, message('first'), new AbortController().signal));
    const started = first.next();
    socket.emit({ conversationId: 'c1', type: 'run.started', payload: { runId: 'run_a' } });
    await started;
    const second = collect(socketRun(socket, message('second'), new AbortController().signal));
    // The second message is rejected before the first run sends anything more.
    socket.emit({ conversationId: 'c1', type: 'run.failed', payload: { runId: 'run_b', error: { status: 409 } } });
    await expect(second).resolves.toMatchObject([{ type: 'run.failed', runId: 'run_b' }]);
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm', delta: 'still coming' } });
    socket.emit({ conversationId: 'c1', type: 'run.completed', payload: { runId: 'run_a' } });
    expect((await first.next()).value).toEqual({ type: 'message.delta', messageId: 'm', delta: 'still coming' });
    expect((await first.next()).value).toEqual({ type: 'run.completed', runId: 'run_a' });
  });

  it('ignores the rest of a stopped run when the next message is sent', async () => {
    const socket = fakeSocket();
    const stop = new AbortController();
    const stopped = iterate(socketRun(socket, message('first'), stop.signal));
    const firstEvent = stopped.next();
    socket.emit({ conversationId: 'c1', type: 'run.started', payload: { runId: 'run_old' } });
    expect((await firstEvent).value).toEqual({ type: 'run.started', runId: 'run_old' });
    stop.abort();
    await expect(stopped.next()).rejects.toThrow();

    // Sent while the stopped run still streams: the server rejects it, and the old run's tail is not this run's.
    const rejected = collect(socketRun(socket, message('second'), new AbortController().signal));
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'old', delta: 'tail' } });
    socket.emit({ conversationId: 'c1', type: 'run.completed', payload: { runId: 'run_old' } });
    socket.emit({
      conversationId: 'c1',
      type: 'run.failed',
      payload: { runId: 'run_new', error: { status: 409 } }
    });
    await expect(rejected).resolves.toEqual([
      {
        type: 'run.failed',
        runId: 'run_new',
        message: 'This conversation is still answering. Try again when it finishes.'
      }
    ]);

    // Once the old run ended, the next message runs normally.
    const next = collect(socketRun(socket, message('third'), new AbortController().signal));
    socket.emit({ conversationId: 'c1', type: 'run.started', payload: { runId: 'run_3' } });
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm3', delta: 'ok' } });
    socket.emit({ conversationId: 'c1', type: 'run.completed', payload: { runId: 'run_3' } });
    await expect(next).resolves.toEqual([
      { type: 'run.started', runId: 'run_3' },
      { type: 'message.delta', messageId: 'm3', delta: 'ok' },
      { type: 'run.completed', runId: 'run_3' }
    ]);
  });

  it('words run.failed by its HTTP status and falls back for the rest', () => {
    const failed = (error: unknown) =>
      mapSocketEvent({ conversationId: 'c', type: 'run.failed', payload: { runId: 'r', error } });
    expect(failed({ status: 409 })).toEqual({
      type: 'run.failed',
      runId: 'r',
      message: 'This conversation is still answering. Try again when it finishes.'
    });
    expect(failed({ status: 400 })).toMatchObject({
      message: 'The assistant could not accept this message. Edit it and try again.'
    });
    expect(failed({ status: 503 })).toMatchObject({ message: expect.stringContaining('not configured') });
    expect(failed({ status: 500 })).toMatchObject({
      message: 'The assistant hit an error while answering. Try again.'
    });
    expect(failed(undefined)).toMatchObject({ message: 'The assistant hit an error while answering. Try again.' });
  });

  it('passes the cursor for an earlier page and returns the next one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          body: { messages: [{ id: 'm3', role: 'assistant', content: 'part one. ' }], nextCursor: 'm3' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const page = await forNote('n').getMessages('c', 'm9');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.test/zeppelin/api/notes/n/conversations/c/messages?limit=50&cursor=m9'
    );
    expect(page).toEqual({ messages: [{ id: 'm3', role: 'assistant', content: 'part one. ' }], earlierCursor: 'm3' });
  });

  it('explains a missing assistant configuration instead of the bare status', () => {
    expect(new AssistantHttpError(503, null).message).toBe(
      'The assistant is not configured on this server. Ask an administrator to enable it.'
    );
    expect(new AssistantHttpError(500, null).message).toBe('Assistant request failed with HTTP 500');
  });

  it('stops listening when aborted', async () => {
    const socket = fakeSocket();
    const controller = new AbortController();
    const run = iterate(socketRun(socket, message(), controller.signal));
    const pending = run.next();
    await vi.waitFor(() => expect(socket.listenerCount()).toBe(1));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(socket.listenerCount()).toBe(0);
  });

  it('reports a retryable error when the run goes quiet past the idle timeout', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const pending = collect(socketRun(socket, message(), new AbortController().signal, 1000));
    const outcome = pending.then(
      () => null,
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBeInstanceOf(AssistantStreamError);
    expect(socket.listenerCount()).toBe(0);
  });

  it('fails the run on an event with a malformed payload', async () => {
    const socket = fakeSocket();
    const pending = collect(socketRun(socket, message(), new AbortController().signal));
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm1' } });
    await expect(pending).rejects.toThrow('Assistant event field "delta" is required');
  });

  it('ignores event types the server does not define', () => {
    expect(
      mapSocketEvent({ conversationId: 'c', type: 'proposal.created', payload: { kind: 'insert', text: 'x' } })
    ).toBeUndefined();
    expect(mapSocketEvent({ conversationId: 'c', type: 'ui.reveal', payload: { paragraphId: 'p1' } })).toBeUndefined();
  });

  it('drops late responses and aborts runs once a scoped transport is deactivated', async () => {
    let resolveList: (threads: []) => void = () => undefined;
    let runSignal: AbortSignal | undefined;
    const inner = {
      listThreads: vi.fn(() => new Promise<[]>(resolve => (resolveList = resolve))),
      createThread: vi.fn(),
      deleteThread: vi.fn(),
      getMessages: vi.fn(),
      openRun: async function* (_id: string, _body: unknown, signal: AbortSignal): AsyncIterable<AssistantEvent> {
        runSignal = signal;
        yield { type: 'run.started' };
        await new Promise(() => undefined);
      }
    };
    const scoped = scopeTransport(inner, 'note-1');
    const list = scoped.transport.listThreads();
    const run = iterate(scoped.transport.openRun('t', { prompt: 'hi' }, new AbortController().signal));
    await run.next();
    expect(inner.listThreads).toHaveBeenCalledWith({ noteId: 'note-1' });

    scoped.setActive(false);
    resolveList([]);

    await expect(list).rejects.toMatchObject({ name: 'AbortError' });
    expect(runSignal?.aborted).toBe(true);
    await expect(scoped.transport.getMessages('t')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('shows one bubble per turn and hides tool and system messages', () => {
    expect(
      toVisibleMessages([
        { id: 'u1', role: 'user', content: 'improve' },
        { id: 'a1', role: 'assistant', content: '' },
        { id: 't1', role: 'tool', content: '{}' },
        { id: 'a2', role: 'assistant', content: 'Reading.' },
        { id: 't2', role: 'tool', content: '{}' },
        { id: 'a3', role: 'assistant', content: 'Done.' },
        { id: 's1', role: 'system', content: 'hidden' }
      ])
    ).toEqual([
      { id: 'u1', role: 'user', content: 'improve' },
      // The merged bubble keeps the id of its last message.
      { id: 'a3', role: 'assistant', content: 'Reading.\n\nDone.' }
    ]);
  });
});
