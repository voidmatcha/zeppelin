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

import { act } from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react';
import type { AssistantEvent, AssistantMessage, AssistantMessagePage, AssistantTransport } from '@zeppelin/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { ZeppelinThemeProvider } from '@/theme';
import { AssistantPanel, AssistantPanelProps } from './AssistantPanel';
import { writeSelectedThread } from './assistantSession';

// A conversation history page as the transport returns it.
const history = (messages: AssistantMessage[], earlierCursor: string | null = null) =>
  vi.fn().mockResolvedValue({ messages, earlierCursor });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const emptyRun = async function* (..._args: Parameters<AssistantTransport['openRun']>): AsyncIterable<AssistantEvent> {
  yield { type: 'run.completed' };
};

const transport = (overrides: Partial<AssistantTransport> = {}): AssistantTransport => ({
  listThreads: vi.fn().mockResolvedValue([{ id: 'thread-1', title: 'First' }]),
  createThread: vi.fn().mockResolvedValue({ id: 'new-thread', title: 'New' }),
  deleteThread: vi.fn().mockResolvedValue(undefined),
  getMessages: history([]),
  openRun: emptyRun,
  ...overrides
});

// Renders the panel as AssistantWorkspace does, with a handle to re-render it with new props.
const mount = (element: HTMLElement, initialProps: AssistantPanelProps) => {
  const root = createRoot(element);
  const render = (props: AssistantPanelProps) =>
    root.render(
      <ZeppelinThemeProvider prefixCls="zeppelin-ai">
        <AssistantPanel {...props} />
      </ZeppelinThemeProvider>
    );
  render(initialProps);
  return { update: render, unmount: () => root.unmount() };
};
type AssistantPanelMountHandle = ReturnType<typeof mount>;

describe('AssistantPanel', () => {
  let host: HTMLElement | null = null;
  let handle: AssistantPanelMountHandle | null = null;

  const mountPanel = (props: AssistantPanelProps): void => {
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      handle = mount(host as HTMLElement, props);
    });
  };

  afterEach(() => {
    if (handle) {
      const current = handle;
      act(() => current.unmount());
      handle = null;
    }
    host?.remove();
    host = null;
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('reopens the conversation last selected for the note', async () => {
    writeSelectedThread('note-1', 'two');
    const getMessages = history([]);
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'one', title: 'One' },
          { id: 'two', title: 'Two' }
        ]),
        getMessages
      }),
      noteId: 'note-1'
    });
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith('two'));
    expect((within(host!).getByRole('combobox', { name: 'Thread' }) as HTMLSelectElement).value).toBe('two');
  });

  it('keeps drafts separate across threads and restores them after remount', async () => {
    const props = {
      ...transport({ listThreads: vi.fn().mockResolvedValue([{ id: 'one' }, { id: 'two' }]) }),
      noteId: 'note-1'
    };
    mountPanel(props);
    const input = () => within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    fireEvent.change(input(), { target: { value: 'First unsent question' } });
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'two' } });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    expect(input()).toHaveProperty('value', '');
    fireEvent.change(input(), { target: { value: 'Second unsent question' } });
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    mountPanel(props);
    await waitFor(() => expect(input()).toHaveProperty('value', 'Second unsent question'));
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'one' } });
    await waitFor(() => expect(input()).toHaveProperty('value', 'First unsent question'));
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(input()).toHaveProperty('value', ''));
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'two' } });
    await waitFor(() => expect(input()).toHaveProperty('value', 'Second unsent question'));
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'one' } });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    expect(input()).toHaveProperty('value', '');
  });

  it('opens a new conversation without creating it on the server and keeps the old draft', async () => {
    const createThread = vi.fn().mockResolvedValue({ id: 'new-thread' });
    mountPanel({ ...transport({ createThread }), noteId: 'note-1' });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: 'Old thread draft' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'New thread' }));
    expect(input).toHaveProperty('value', '');
    expect(input).toHaveProperty('disabled', false);
    expect(createThread).not.toHaveBeenCalled();
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-1' } });
    await waitFor(() => expect(input).toHaveProperty('value', 'Old thread draft'));
  });

  it('removes a conversation it just created when the server rejects the first message', async () => {
    const deleteThread = vi.fn().mockResolvedValue(undefined);
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([]),
        createThread: vi.fn().mockResolvedValue({ id: 'rejected-thread', title: 'Why?' }),
        deleteThread,
        openRun: async function* () {
          yield { type: 'run.failed', message: 'The assistant is not configured on this server.' };
        }
      }),
      noteId: 'note-1'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: 'Why?' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(deleteThread).toHaveBeenCalledWith('rejected-thread'));
    expect(await within(host!).findByText('The assistant is not configured on this server.')).toBeTruthy();
    expect(input).toHaveProperty('value', 'Why?');
    expect(within(host!).queryByText('Why?', { selector: 'option' })).toBeNull();
    expect(within(host!).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('restores a first-message draft only for its account and notebook', async () => {
    const props = {
      ...transport({ listThreads: vi.fn().mockResolvedValue([]) }),
      noteId: 'note-1',
      draftOwner: 'alice'
    };
    mountPanel(props);
    const input = () => within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    fireEvent.change(input(), { target: { value: 'Private draft' } });
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    mountPanel(props);
    await waitFor(() => expect(input()).toHaveProperty('value', 'Private draft'));
    act(() => handle!.update({ ...props, draftOwner: 'bob' }));
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    expect(input()).toHaveProperty('value', '');
  });

  it('renders streamed assistant text, reconciles the final message, and shows tool steps', async () => {
    const releaseFinal = deferred<void>();
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      yield { type: 'run.started', runId: 'run-1' };
      yield { type: 'message.delta', messageId: 'assistant-1', delta: 'Hel' };
      yield { type: 'tool_call.started', toolCallId: 'tool-1', name: 'Search notebook' };
      yield { type: 'message.delta', messageId: 'assistant-1', delta: 'lo?' };
      yield { type: 'tool_call.done', toolCallId: 'tool-1', name: 'Search notebook' };
      await releaseFinal.promise;
      yield { type: 'message.done', messageId: 'assistant-1', content: 'Hello!' };
      yield { type: 'run.completed' };
    });
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), {
      target: { value: 'Summarize' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(within(host!).getByText('Hello?')).toBeTruthy());
    expect(within(host!).getByText('✓ Search notebook')).toBeTruthy();
    releaseFinal.resolve();
    await waitFor(() => expect(within(host!).getByText('Hello!')).toBeTruthy());
    expect(within(host!).queryByText('Hello?')).toBeNull();
    expect(openRun).toHaveBeenCalledWith('thread-1', { prompt: 'Summarize' }, expect.any(AbortSignal));
  });

  it('preserves Shift+Enter without sending', async () => {
    const openRun = vi.fn(emptyRun);
    mountPanel(transport({ openRun }));
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'First line' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(openRun).not.toHaveBeenCalled();
  });

  it('stops following streamed text when scrolled up and resumes at the bottom', async () => {
    const next = deferred<void>();
    const last = deferred<void>();
    mountPanel(
      transport({
        openRun: async function* () {
          yield { type: 'message.delta', messageId: 'answer', delta: 'First chunk' };
          await next.promise;
          yield { type: 'message.delta', messageId: 'answer', delta: ' second chunk' };
          await last.promise;
          yield { type: 'message.done', messageId: 'answer', content: 'Final answer' };
          yield { type: 'run.completed' };
        }
      })
    );
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    const area = within(host!).getByLabelText('Messages');
    Object.defineProperties(area, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } });
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Go' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByText('First chunk')).toBeTruthy());
    expect(area.scrollTop).toBe(1000);
    area.scrollTop = 100;
    fireEvent.scroll(area);
    await act(async () => next.resolve());
    await waitFor(() => expect(within(host!).getByText('First chunk second chunk')).toBeTruthy());
    expect(area.scrollTop).toBe(100);
    fireEvent.click(within(host!).getByRole('button', { name: 'New reply' }));
    expect(area.scrollTop).toBe(1000);
    expect(within(host!).queryByRole('button', { name: 'New reply' })).toBeNull();
    area.scrollTop = 790;
    fireEvent.scroll(area);
    Object.defineProperty(area, 'scrollHeight', { value: 1200 });
    await act(async () => last.resolve());
    await waitFor(() => expect(within(host!).getByText('Final answer')).toBeTruthy());
    expect(area.scrollTop).toBe(1200);
  });

  it('frees the composer on Stop and keeps showing the answer the server is still sending', async () => {
    let runSignal: AbortSignal | undefined;
    const more = deferred<void>();
    const openRun = vi.fn(async function* (
      _threadId: string,
      _body: { prompt: string },
      signal: AbortSignal
    ): AsyncIterable<AssistantEvent> {
      runSignal = signal;
      yield { type: 'run.started', runId: 'r1' };
      yield { type: 'message.delta', messageId: 'a1', delta: 'First part. ' };
      await more.promise;
      yield { type: 'message.delta', messageId: 'a1', delta: 'Second part.' };
      yield { type: 'run.completed', runId: 'r1' };
    });
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'thread-1', title: 'First' },
          { id: 'thread-2', title: 'Second' }
        ]),
        openRun
      })
    });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    const input = within(host!).getByPlaceholderText('Ask about this notebook');
    fireEvent.change(input, { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    expect(await within(host!).findByText(/First part\./)).toBeTruthy();
    fireEvent.click(within(host!).getByRole('button', { name: /Stop/ }));

    // The composer is free at once, while the server's answer keeps arriving in the same bubble.
    expect(within(host!).getByRole('button', { name: /Send/ })).toBeTruthy();
    expect(host!.querySelector('.assistant-announcement')?.textContent).toContain('Stopped waiting');
    await act(async () => more.resolve());
    expect(await within(host!).findByText(/First part\. Second part\./)).toBeTruthy();
    expect(runSignal?.aborted).toBe(false);
    // Its end adds no error.
    expect(within(host!).queryByRole('alert')).toBeNull();
  });

  it('stops listening to a stopped answer when the user switches conversations', async () => {
    let runSignal: AbortSignal | undefined;
    const openRun = vi.fn(async function* (
      _threadId: string,
      _body: { prompt: string },
      signal: AbortSignal
    ): AsyncIterable<AssistantEvent> {
      runSignal = signal;
      yield { type: 'run.started', runId: 'r1' };
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'thread-1', title: 'First' },
          { id: 'thread-2', title: 'Second' }
        ]),
        openRun
      })
    });
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    fireEvent.click(await within(host!).findByRole('button', { name: /Stop/ }));
    expect(runSignal?.aborted).toBe(false);
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-2' } });
    await waitFor(() => expect(runSignal?.aborted).toBe(true));
  });

  it('does not send when Enter commits an IME composition', async () => {
    const openRun = vi.fn(emptyRun);
    mountPanel({ ...transport({ openRun }) });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    const input = within(host!).getByPlaceholderText('Ask about this notebook');
    fireEvent.change(input, { target: { value: '안녕하세요' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(openRun).not.toHaveBeenCalled();
    expect(input).toHaveProperty('value', '안녕하세요');

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: false });
    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(1));
  });

  it('shows a run error and retries without duplicating the user message', async () => {
    let attempt = 0;
    let failedRunClosed = false;
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      attempt += 1;
      if (attempt === 1) {
        try {
          yield { type: 'run.failed', message: 'Model unavailable' };
          await new Promise(() => undefined);
        } finally {
          failedRunClosed = true;
        }
      } else {
        yield { type: 'message.done', messageId: 'answer', content: 'Recovered' };
        yield { type: 'run.completed' };
      }
    });
    mountPanel({ ...transport({ openRun }) });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Try this' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByText('Model unavailable')).toBeTruthy());
    await waitFor(() => expect(failedRunClosed).toBe(true));
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(within(host!).getByText('Recovered')).toBeTruthy());
    expect(openRun).toHaveBeenCalledTimes(2);
    expect(within(host!).getAllByText('Try this')).toHaveLength(1);
  });

  it('switches threads and drops a late response from the previous thread', async () => {
    const first = deferred<AssistantMessagePage>();
    const getMessages = vi.fn((threadId: string) =>
      threadId === 'thread-1'
        ? first.promise
        : Promise.resolve({
            messages: [{ id: 'm2', role: 'assistant' as const, content: 'Second answer' }],
            earlierCursor: null
          })
    );
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'thread-1', title: 'First' },
          { id: 'thread-2', title: 'Second' }
        ]),
        getMessages
      })
    });

    await waitFor(() => expect(within(host!).getByText('Second')).toBeTruthy());
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-2' } });
    await waitFor(() => expect(within(host!).getByText('Second answer')).toBeTruthy());
    first.resolve({ messages: [{ id: 'late', role: 'assistant', content: 'Late first answer' }], earlierCursor: null });
    await act(async () => {
      await first.promise;
    });

    expect(within(host!).queryByText('Late first answer')).toBeNull();
    expect(within(host!).getByText('Second answer')).toBeTruthy();
  });

  it('scopes thread discovery, ignores explicit note mismatches, and titles a new thread from its first prompt', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      { id: 'wrong-note', title: 'Other note', noteId: 'note-2' },
      { id: 'unscoped', title: 'Legacy thread' }
    ]);
    // The server stores the title sent on creation.
    const createThread = vi.fn(async ({ title }: { title?: string }) => ({
      id: 'new-thread',
      title,
      noteId: 'note-1'
    }));
    const getMessages = history([]);
    mountPanel({ ...transport({ listThreads, createThread, getMessages }), noteId: 'note-1' });

    await waitFor(() => expect(within(host!).getByText('Legacy thread')).toBeTruthy());
    expect(listThreads).toHaveBeenCalledWith({ noteId: 'note-1' });
    expect(within(host!).queryByText('Other note')).toBeNull();
    expect(getMessages).toHaveBeenCalledWith('unscoped');

    fireEvent.click(within(host!).getByRole('button', { name: 'New thread' }));
    await waitFor(() => expect(within(host!).getByText('New conversation')).toBeTruthy());
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Explain the sales trend' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(within(host!).getAllByText('Explain the sales trend')).toHaveLength(2));
    expect((within(host!).getByRole('combobox', { name: 'Thread' }) as HTMLSelectElement).selectedOptions[0].text).toBe(
      'Explain the sales trend'
    );
  });

  it('shows no error when the host drops a send because the notebook changed', async () => {
    const openRun = vi.fn(
      (): AsyncIterable<AssistantEvent> => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new DOMException('Notebook changed', 'AbortError'))
        })
      })
    );
    mountPanel({
      ...transport({ listThreads: vi.fn().mockResolvedValue([{ id: 'thread-1', title: 'First' }]), openRun }),
      noteId: 'note-1'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(openRun).toHaveBeenCalled());
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    expect(within(host!).queryByRole('alert')).toBeNull();
  });

  it('follows the server on who can send to a conversation', async () => {
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'closed', title: 'Closed', canSendMessage: false },
          { id: 'open', title: 'Open', canSendMessage: true }
        ])
      }),
      noteId: 'note-1'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('disabled', true));
    expect(within(host!).getByText(/You cannot send messages to this conversation/)).toBeTruthy();
    expect(within(host!).queryByRole('button', { name: /^Delete/ })).toBeNull();

    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'open' } });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    expect(within(host!).queryByText(/You cannot send messages/)).toBeNull();
  });

  it('deletes the last thread while messages are pending and ignores the late response', async () => {
    const pendingMessages = deferred<AssistantMessagePage>();
    const deleteThread = vi.fn().mockResolvedValue(undefined);
    const createThread = vi.fn().mockResolvedValue({ id: 'created-thread', title: 'Created conversation' });
    const openRun = vi.fn(emptyRun);
    mountPanel({
      ...transport({
        deleteThread,
        createThread,
        getMessages: vi.fn().mockReturnValue(pendingMessages.promise),
        openRun
      }),
      noteId: 'note-1'
    });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    expect(within(host!).getByRole('button', { name: 'New thread' })).toHaveProperty('disabled', true);
    fireEvent.click(within(host!).getByRole('button', { name: 'Delete First' }));

    await waitFor(() => expect(deleteThread).toHaveBeenCalledWith('thread-1'));
    await waitFor(() =>
      expect(within(host!).getByRole('button', { name: 'New thread' })).toHaveProperty('disabled', false)
    );

    pendingMessages.resolve({
      messages: [{ id: 'late', role: 'assistant', content: 'Deleted thread answer' }],
      earlierCursor: null
    });
    await act(async () => {
      await pendingMessages.promise;
    });
    expect(within(host!).queryByText('Deleted thread answer')).toBeNull();

    fireEvent.click(within(host!).getByRole('button', { name: 'New thread' }));
    expect(createThread).not.toHaveBeenCalled();

    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), {
      target: { value: 'Continue' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(createThread).toHaveBeenCalledWith({ noteId: 'note-1', title: 'Continue' }));
    await waitFor(() =>
      expect(openRun).toHaveBeenCalledWith('created-thread', { prompt: 'Continue' }, expect.any(AbortSignal))
    );
  });

  it('aborts an active run when switching threads', async () => {
    let runSignal: AbortSignal | undefined;
    const openRun = async function* (
      _threadId: string,
      _body: { prompt: string },
      signal: AbortSignal
    ): AsyncIterable<AssistantEvent> {
      runSignal = signal;
      yield { type: 'run.started' };
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    };
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'thread-1', title: 'First' },
          { id: 'thread-2', title: 'Second' }
        ]),
        openRun
      })
    });

    await waitFor(() => expect(within(host!).getByText('Second')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByRole('button', { name: /Stop/ })).toBeTruthy());
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-2' } });

    await waitFor(() => expect(runSignal?.aborted).toBe(true));
    expect(within(host!).getByRole('button', { name: /Send/ })).toBeTruthy();
  });

  it('drops old-note responses and aborts an active run on note change and unmount', async () => {
    const oldThreads = deferred<Array<{ id: string; title: string }>>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => oldThreads.promise)
      .mockResolvedValueOnce([{ id: 'new-thread', title: 'New note thread' }]);
    const props = { ...transport({ listThreads }), noteId: 'old-note' };
    mountPanel(props);

    act(() => handle!.update({ ...props, noteId: 'new-note' }));
    await waitFor(() => expect(within(host!).getByText('New note thread')).toBeTruthy());
    oldThreads.resolve([{ id: 'old-thread', title: 'Old note thread' }]);
    await act(async () => {
      await oldThreads.promise;
    });
    expect(within(host!).queryByText('Old note thread')).toBeNull();

    let signal: AbortSignal | undefined;
    const openRun = async function* (
      _threadId: string,
      _body: { prompt: string },
      nextSignal: AbortSignal
    ): AsyncIterable<AssistantEvent> {
      signal = nextSignal;
      yield { type: 'run.started' };
      await new Promise<void>(resolve => nextSignal.addEventListener('abort', () => resolve(), { once: true }));
    };
    act(() => handle!.update({ ...transport({ openRun }), noteId: 'run-note' }));
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(signal).toBeTruthy());

    const current = handle!;
    handle = null;
    act(() => current.unmount());
    expect(signal?.aborted).toBe(true);
  });
});
