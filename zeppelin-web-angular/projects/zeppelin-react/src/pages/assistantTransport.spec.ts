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

import type { AssistantEvent } from '@zeppelin/sdk';

import {
  AssistantHttpError,
  AssistantStreamError,
  createAssistantTransport,
  scopeTransport,
  toVisibleMessages
} from './assistantTransport';

const forNote = (noteId: string, onAuthError?: (status: number, location: string | null) => void) =>
  createAssistantTransport('https://example.test/zeppelin/api', noteId, onAuthError);

const responseFromChunks = (chunks: Uint8Array[]): Response => {
  return new Response(
    new ReadableStream<Uint8Array>({
      start: controller => {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
};

const iterate = <T>(iterable: AsyncIterable<T>): AsyncIterator<T> => iterable[Symbol.asyncIterator]();

const collect = async (events: AsyncIterable<AssistantEvent>): Promise<AssistantEvent[]> => {
  const collected: AssistantEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

describe('assistant transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the per-note conversation endpoints and unwraps Zeppelin JSON responses', async () => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ status: 'OK', body: [{ id: 'conv-1', title: 'First', note_id: 'note/one' }] }))
      .mockResolvedValueOnce(json({ status: 'OK', body: { id: 'conv-2', title: 'New conversation' } }))
      .mockResolvedValueOnce(json([{ id: 'message-1', role: 'user', content: 'hello' }]))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = forNote('note/one');

    await expect(transport.listThreads()).resolves.toEqual([{ id: 'conv-1', title: 'First', noteId: 'note/one' }]);
    await expect(transport.createThread({})).resolves.toEqual({
      id: 'conv-2',
      title: 'New conversation',
      noteId: 'note/one'
    });
    await expect(transport.getMessages('conv/1')).resolves.toEqual([
      { id: 'message-1', role: 'user', content: 'hello' }
    ]);
    await expect(transport.deleteThread('conv/1')).resolves.toBeUndefined();

    const base = 'https://example.test/zeppelin/api/notes/note%2Fone/conversations';
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [base, 'GET'],
      [base, 'POST'],
      [`${base}/conv%2F1/messages`, 'GET'],
      [`${base}/conv%2F1`, 'DELETE']
    ]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: 'New conversation' })
    });
  });

  it('hands 401 and 405 to the host for JSON and stream requests, but not other failures', async () => {
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
    await expect(collect(transport.openRun('c', { prompt: 'hi' }, new AbortController().signal))).rejects.toMatchObject(
      { status: 405 }
    );
    await expect(transport.getMessages('c')).rejects.toBeInstanceOf(AssistantHttpError);

    expect(onAuthError.mock.calls).toEqual([
      [401, '/login'],
      [405, null]
    ]);
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

  it('buffers split frames and preserves a Korean character split across byte chunks', async () => {
    const wire =
      'event: message.delta\r\n' +
      'data: {"message_id":"message-1","delta":"한글"}\r\n\r\n' +
      'event: run.completed\n' +
      'data: {}\n\n';
    const bytes = new TextEncoder().encode(wire);
    const korean = new TextEncoder().encode('한');
    const koreanStart = bytes.findIndex((byte, index) =>
      korean.every((koreanByte, offset) => bytes[index + offset] === koreanByte)
    );
    const crlfBoundary = wire.indexOf('\r\n\r\n');
    const crlfSplit = new TextEncoder().encode(wire.slice(0, crlfBoundary + 3)).length;
    const lfBoundary = wire.lastIndexOf('\n\n');
    const lfSplit = new TextEncoder().encode(wire.slice(0, lfBoundary + 1)).length;
    const splitPoints = [koreanStart + 1, crlfSplit, lfSplit];
    let start = 0;
    const chunks = splitPoints.map(end => {
      const chunk = bytes.slice(start, end);
      start = end;
      return chunk;
    });
    chunks.push(bytes.slice(start));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFromChunks(chunks)));

    const signal = new AbortController().signal;
    const events = await collect(forNote('note-1').openRun('thread-1', { prompt: 'question' }, signal));

    expect(events).toEqual([
      { type: 'message.delta', messageId: 'message-1', delta: '한글' },
      { type: 'run.completed' }
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/zeppelin/api/notes/note-1/conversations/thread-1/messages',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ content: 'question', context: {} }),
        signal
      })
    );
  });

  it('stops reading when the supplied signal is aborted', async () => {
    const abortController = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => {
        return new Promise(() => undefined);
      },
      cancel
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const iterator = iterate(forNote('note-1').openRun('thread-1', { prompt: 'wait' }, abortController.signal));

    const pending = iterator.next();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: abortController.signal }));
  });

  it('surfaces non-OK status and Location without consuming a stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 401,
          headers: { Location: '/login?next=%2Fzeppelin' }
        })
      )
    );

    const result = collect(forNote('note-1').openRun('thread-1', { prompt: 'hello' }, new AbortController().signal));

    await expect(result).rejects.toEqual(
      expect.objectContaining<Partial<AssistantHttpError>>({
        name: 'AssistantHttpError',
        status: 401,
        location: '/login?next=%2Fzeppelin'
      })
    );
  });
  it('does not emit a buffered frame after abort and releases the reader', async () => {
    const response = responseFromChunks([
      new TextEncoder().encode('event: run.started\ndata: {}\n\nevent: run.completed\ndata: {}\n\n')
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const controller = new AbortController();
    const iterator = iterate(forNote('note-1').openRun('t', { prompt: 'hello' }, controller.signal));
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'run.started' }, done: false });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(response.body!.locked).toBe(false);
  });

  it('surfaces a 405 without a Location header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 405 })));
    await expect(
      collect(forNote('note-1').openRun('t', { prompt: 'hello' }, new AbortController().signal))
    ).rejects.toMatchObject({ status: 405, location: null });
  });

  it('reports a retryable error when the stream ends before a terminal event', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          responseFromChunks([new TextEncoder().encode('event: run.started\ndata: {"run_id":"run-1"}\n\n')])
        )
    );

    await expect(
      collect(forNote('note-1').openRun('t', { prompt: 'hello' }, new AbortController().signal))
    ).rejects.toEqual(
      expect.objectContaining<Partial<AssistantStreamError>>({
        name: 'AssistantStreamError',
        retryable: true,
        message: expect.stringContaining('Retry')
      })
    );
  });

  it.each(['run.failed', 'error'] as const)('accepts %s as a terminal event', async terminalType => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          responseFromChunks([new TextEncoder().encode(`event: ${terminalType}\ndata: {"message":"stopped"}\n\n`)])
        )
    );

    await expect(
      collect(forNote('note-1').openRun('t', { prompt: 'hello' }, new AbortController().signal))
    ).resolves.toEqual([{ type: terminalType, message: 'stopped' }]);
  });

  it('skips unknown event types and keeps streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          responseFromChunks([
            new TextEncoder().encode(
              'event: usage\ndata: {"tokens":3}\n\nevent: message.delta\ndata: {"message_id":"m","delta":"hi"}\n\nevent: run.completed\ndata: {}\n\n'
            )
          ])
        )
    );

    await expect(
      collect(forNote('note-1').openRun('t', { prompt: 'hello' }, new AbortController().signal))
    ).resolves.toEqual([{ type: 'message.delta', messageId: 'm', delta: 'hi' }, { type: 'run.completed' }]);
  });

  it('talks to the per-note conversation API and maps its snake_case events', async () => {
    const frames = [
      'event: run.started\ndata: {"run_id":"run_1"}\n\n',
      'event: tool_call.started\ndata: {"tool_call_id":"c1","name":"get_paragraph","arguments":{"paragraph_id":"p1"}}\n\n',
      'event: tool_call.done\ndata: {"tool_call_id":"c1","name":"get_paragraph","status":"completed"}\n\n',
      'event: proposal.created\ndata: {"kind":"paragraph","paragraph_id":"p1","original_text":"old","text":"new"}\n\n',
      'event: proposal.created\ndata: {"kind":"insert","after_paragraph_id":null,"text":"%md\\nhi"}\n\n',
      'event: ui.reveal\ndata: {"paragraph_id":"p1"}\n\n',
      'event: usage.extra\ndata: {"tokens":1}\n\n',
      'event: message.delta\ndata: {"message_id":"m1","delta":"hi"}\n\n',
      'event: message.done\ndata: {"message_id":"m1","content":"hi"}\n\n',
      'event: run.completed\ndata: {"run_id":"run_1"}\n\n'
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(responseFromChunks([new TextEncoder().encode(frames)]));
    vi.stubGlobal('fetch', fetchMock);

    const events = await collect(
      forNote('n 1').openRun(
        'conv_1',
        {
          prompt: 'improve',
          activeParagraphId: 'p1',
          context: { noteId: 'n 1', target: { kind: 'paragraph', paragraphId: 'p1' }, originalText: 'old' }
        },
        new AbortController().signal
      )
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.test/zeppelin/api/notes/n%201/conversations/conv_1/messages'
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      content: 'improve',
      context: { activeParagraphId: 'p1', target: { kind: 'paragraph', paragraphId: 'p1' }, originalText: 'old' }
    });
    expect(events).toEqual([
      { type: 'run.started', runId: 'run_1' },
      { type: 'tool_call.started', toolCallId: 'c1', name: 'get_paragraph' },
      { type: 'tool_call.done', toolCallId: 'c1', name: 'get_paragraph' },
      { type: 'proposal.created', target: { kind: 'paragraph', paragraphId: 'p1' }, originalText: 'old', code: 'new' },
      {
        type: 'proposal.created',
        target: { kind: 'insert', afterParagraphId: null },
        originalText: undefined,
        code: '%md\nhi'
      },
      { type: 'ui.reveal', paragraphId: 'p1' },
      { type: 'message.delta', messageId: 'm1', delta: 'hi' },
      { type: 'message.done', messageId: 'm1', content: 'hi' },
      { type: 'run.completed' }
    ]);
  });

  it('maps run failures that carry an error object', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          responseFromChunks([
            new TextEncoder().encode(
              'event: run.failed\ndata: {"run_id":"r","error":{"code":"x","message":"Model down"}}\n\n'
            )
          ])
        )
    );
    await expect(collect(forNote('n').openRun('c', { prompt: 'hi' }, new AbortController().signal))).resolves.toEqual([
      { type: 'run.failed', message: 'Model down' }
    ]);
  });

  it('shows one bubble per turn and hides tool and system messages', () => {
    expect(
      toVisibleMessages([
        { id: 'u1', role: 'user', content: 'improve' },
        { id: 'a1', role: 'assistant', content: '' },
        { id: 't1', role: 'tool', content: '{}' },
        { id: 'a2', role: 'assistant', content: 'Reading. ' },
        { id: 't2', role: 'tool', content: '{}' },
        { id: 'a3', role: 'assistant', content: 'Proposed.' },
        { id: 's1', role: 'system', content: 'hidden' }
      ])
    ).toEqual([
      { id: 'u1', role: 'user', content: 'improve' },
      { id: 'a2', role: 'assistant', content: 'Reading. Proposed.' }
    ]);
  });
});
