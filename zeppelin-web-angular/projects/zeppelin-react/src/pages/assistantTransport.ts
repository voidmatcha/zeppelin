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

import type {
  AssistantEvent,
  AssistantMessagePage,
  AssistantMessage,
  AssistantSendMessage,
  AssistantSocket,
  AssistantSocketEvent,
  AssistantThread,
  AssistantTransport
} from '@zeppelin/sdk';

const HTTP_MESSAGES: Record<number, string> = {
  403: 'You do not have permission for this conversation.',
  404: 'This conversation or note no longer exists.',
  409: 'This conversation is still answering. Try again when it finishes.',
  503: 'The assistant is not configured on this server. Ask an administrator to enable it.'
};

// run.failed carries only the HTTP status of the rejected or failed run, so the UI words it.
const RUN_ERROR_MESSAGES: Record<number, string> = {
  400: 'The assistant could not accept this message. Edit it and try again.',
  // Also returned when the user lost read access to the note, so it does not name the owner.
  403: 'You do not have permission to send messages to this conversation.',
  404: 'This conversation or note no longer exists.',
  409: 'This conversation is still answering. Try again when it finishes.',
  503: 'The assistant is not configured on this server. Ask an administrator to enable it.'
};
const NOT_AVAILABLE_MESSAGE = 'The assistant is not available on this server, or this note no longer exists.';
const RUN_ERROR_FALLBACK = 'The assistant hit an error while answering. Try again.';

export class AssistantHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly location: string | null,
    message = HTTP_MESSAGES[status] ?? `Assistant request failed with HTTP ${status}`
  ) {
    super(message);
    this.name = 'AssistantHttpError';
  }
}

export class AssistantStreamError extends Error {
  constructor() {
    super('The assistant stopped responding before the reply finished. Retry the request.');
    this.name = 'AssistantStreamError';
  }
}

// The server sends no heartbeat, so a run that goes quiet this long is treated as lost.
export const RUN_IDLE_TIMEOUT_MS = 180_000;

const optionalString = (data: Record<string, unknown>, field: string): string | undefined => {
  const value = data[field];
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`Assistant event field "${field}" must be a string`);
  }
  return value;
};

const requiredString = (data: Record<string, unknown>, field: string): string => {
  const value = optionalString(data, field);
  if (value === undefined) {
    throw new Error(`Assistant event field "${field}" is required`);
  }
  return value;
};

const errorMessage = (data: Record<string, unknown>): string => {
  const error = data.error;
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  return (typeof status === 'number' && RUN_ERROR_MESSAGES[status]) || RUN_ERROR_FALLBACK;
};

/** Maps an ASSISTANT_EVENT to the UI contract; unknown types map to undefined, so new server events are ignored. */
export const mapSocketEvent = ({ type, payload }: AssistantSocketEvent): AssistantEvent | undefined => {
  const data = payload ?? {};
  switch (type) {
    case 'run.started':
      return { type, runId: optionalString(data, 'runId') };
    case 'run.completed':
      return { type, runId: optionalString(data, 'runId') };
    case 'run.failed':
      return { type, runId: optionalString(data, 'runId'), message: errorMessage(data) };
    case 'message.delta':
      return { type, messageId: requiredString(data, 'messageId'), delta: requiredString(data, 'delta') };
    case 'message.done':
      return { type, messageId: requiredString(data, 'messageId'), content: requiredString(data, 'content') };
    case 'tool_call.started':
      return { type, toolCallId: requiredString(data, 'toolCallId'), name: requiredString(data, 'name') };
    case 'tool_call.done':
      return { type, toolCallId: requiredString(data, 'toolCallId'), name: optionalString(data, 'name') };
    default:
      return undefined;
  }
};

const isTerminal = (event: AssistantEvent): boolean => event.type === 'run.completed' || event.type === 'run.failed';

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string | null;
}

/** One bubble per turn: tool and system messages are hidden, tool rounds merge under the last message's id. */
export const toVisibleMessages = (messages: ConversationMessage[]): AssistantMessage[] => {
  const visible: AssistantMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      visible.push({ id: message.id, role: 'user', content: message.content ?? '' });
    } else if (message.role === 'assistant' && message.content) {
      const last = visible[visible.length - 1];
      if (last?.role === 'assistant') {
        last.id = message.id;
        last.content += `\n\n${message.content}`;
      } else {
        visible.push({ id: message.id, role: 'assistant', content: message.content });
      }
    }
  }
  return visible;
};

const requestHeaders = {
  // As the shell does in production, so the server answers 401/405 instead of a login page.
  'X-Requested-With': 'XMLHttpRequest'
};

// Zeppelin JSON endpoints wrap the payload as { status, message, body }.
const unwrapBody = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && 'body' in value ? (value as { body: unknown }).body : value;

/** Hands 401/405 to the host, which owns login redirects and logout. */
export type AssistantAuthErrorHandler = (status: number, location: string | null) => void;

const httpError = (response: Response, onAuthError?: AssistantAuthErrorHandler): AssistantHttpError => {
  const error = new AssistantHttpError(response.status, response.headers.get('Location'));
  if (error.status === 401 || error.status === 405) {
    onAuthError?.(error.status, error.location);
  }
  return error;
};

const requestJson = async <T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
  onAuthError?: AssistantAuthErrorHandler
): Promise<T> => {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers:
      init.body === undefined
        ? { ...requestHeaders, Accept: 'application/json' }
        : { ...requestHeaders, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (!response.ok) {
    throw httpError(response, onAuthError);
  }
  const text = await response.text();
  return (text ? unwrapBody(JSON.parse(text)) : undefined) as T;
};

// A server without the assistant API answers the note's conversation collection with 404.
const collectionRequest = async <T>(...args: Parameters<typeof requestJson>): Promise<T> => {
  try {
    return await requestJson<T>(...args);
  } catch (error) {
    if (error instanceof AssistantHttpError && error.status === 404) {
      throw new AssistantHttpError(404, error.location, NOT_AVAILABLE_MESSAGE);
    }
    throw error;
  }
};

// Runs aborted by a thread or note switch (Stop keeps listening). The server finishes them, so later runs
// skip their events. Capped, since an id is otherwise dropped only when its terminal event is seen.
const abandonedRuns = new Set<string>();
const MAX_ABANDONED_RUNS = 200;
// Runs an iterator is still receiving (a stopped one keeps streaming); others on the conversation skip their events.
const runsInProgress = new Set<string>();

/** For tests: forget the runs tracked across iterators. */
export const resetRunTracking = () => {
  abandonedRuns.clear();
  runsInProgress.clear();
};

/**
 * Sends one message over the host's notebook WebSocket and yields that conversation's events until a terminal one.
 * Until this message's run.started arrives, only a rejection (run.failed) belongs to it; events of an abandoned or
 * still-streaming run on the same conversation are skipped.
 */
export async function* socketRun(
  socket: AssistantSocket,
  message: AssistantSendMessage,
  signal: AbortSignal,
  idleTimeoutMs = RUN_IDLE_TIMEOUT_MS
): AsyncIterable<AssistantEvent> {
  signal.throwIfAborted();
  const queue: Array<AssistantEvent | Error> = [];
  let wake: (() => void) | undefined;
  const push = (item: AssistantEvent | Error) => {
    queue.push(item);
    wake?.();
  };
  const unsubscribe = socket.subscribe(event => {
    if (event.conversationId !== message.conversationId) return;
    try {
      const mapped = mapSocketEvent(event);
      if (mapped) push(mapped);
    } catch (error) {
      push(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort, { once: true });
  let started = false;
  let ownRunId: string | undefined;
  let ended = false;
  try {
    socket.send(message);
    while (true) {
      signal.throwIfAborted();
      if (queue.length === 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>(resolve => {
          wake = resolve;
          timer = setTimeout(() => push(new AssistantStreamError()), idleTimeoutMs);
        });
        clearTimeout(timer);
        wake = undefined;
      }
      signal.throwIfAborted();
      const item = queue.shift();
      if (item === undefined) continue;
      if (item instanceof Error) throw item;
      const runId = 'runId' in item ? item.runId : undefined;
      if (runId && runId !== ownRunId && (abandonedRuns.has(runId) || runsInProgress.has(runId))) {
        if (isTerminal(item)) abandonedRuns.delete(runId);
        continue;
      }
      // Once running, only its own terminal event ends it; deltas have no run id, but runs are one at a time.
      if (started && isTerminal(item) && runId && ownRunId && runId !== ownRunId) continue;
      if (!started) {
        if (item.type === 'run.started') {
          started = true;
          ownRunId = item.runId;
          if (ownRunId) runsInProgress.add(ownRunId);
        } else if (item.type !== 'run.failed') continue;
      }
      if (isTerminal(item)) {
        ended = true;
        // Done as soon as it ends, even if the consumer never pulls again to run `finally`.
        if (ownRunId) runsInProgress.delete(ownRunId);
      }
      yield item;
      if (ended) return;
    }
  } finally {
    // Aborted after the server started it: the run continues server-side.
    if (ownRunId) runsInProgress.delete(ownRunId);
    if (started && !ended && ownRunId) {
      abandonedRuns.add(ownRunId);
      if (abandonedRuns.size > MAX_ABANDONED_RUNS) abandonedRuns.delete(abandonedRuns.values().next().value!);
    }
    signal.removeEventListener('abort', onAbort);
    unsubscribe();
  }
}

type ConversationSummary = {
  id: string;
  title?: string;
  noteId?: string;
  canSendMessage?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
type MessagePage = { messages: ConversationMessage[]; nextCursor?: string | null };

// One page of raw server messages. `getMessages(threadId, earlierCursor)` returns the page before it.
const HISTORY_PAGE_SIZE = 50;

/**
 * Transport for the per-note conversation API. REST for conversations and history (`apiBase` is the host's
 * REST base, e.g. `.../api`); sending goes over the host's notebook WebSocket.
 */
export const createAssistantTransport = (
  apiBase: string,
  noteId: string,
  socket: AssistantSocket,
  onAuthError?: AssistantAuthErrorHandler
): AssistantTransport => {
  const base = `${apiBase.replace(/\/$/, '')}/notes/${encodeURIComponent(noteId)}/conversations`;
  const toThread = (conversation: ConversationSummary): AssistantThread => ({
    id: conversation.id,
    title: conversation.title,
    noteId: conversation.noteId ?? noteId,
    ...(typeof conversation.canSendMessage === 'boolean' ? { canSendMessage: conversation.canSendMessage } : {})
  });
  // The server names an untitled conversation by its creation time.
  const titleFor = (title?: string) => {
    const trimmed = title?.trim().replace(/\s+/g, ' ');
    return trimmed ? { title: trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed } : {};
  };
  return {
    // Latest activity first, so the panel opens on it; undated ones stay last in server order (stable sort).
    listThreads: async () =>
      (await collectionRequest<ConversationSummary[]>(base, {}, onAuthError))
        .map(conversation => ({
          conversation,
          time: Date.parse(conversation.updatedAt ?? conversation.createdAt ?? '') || 0
        }))
        .sort((a, b) => b.time - a.time)
        .map(({ conversation }) => toThread(conversation)),
    createThread: async ({ title } = {}) =>
      toThread(
        await collectionRequest<ConversationSummary>(base, { method: 'POST', body: titleFor(title) }, onAuthError)
      ),
    deleteThread: async threadId => {
      await requestJson<void>(`${base}/${encodeURIComponent(threadId)}`, { method: 'DELETE' }, onAuthError);
    },
    getMessages: async (threadId, before): Promise<AssistantMessagePage> => {
      const cursor = before ? `&cursor=${encodeURIComponent(before)}` : '';
      const page = await requestJson<MessagePage>(
        `${base}/${encodeURIComponent(threadId)}/messages?limit=${HISTORY_PAGE_SIZE}${cursor}`,
        {},
        onAuthError
      );
      // The server pages from the latest message backwards; the panel renders oldest to newest.
      return { messages: toVisibleMessages([...page.messages].reverse()), earlierCursor: page.nextCursor ?? null };
    },
    openRun: (threadId, body, signal) =>
      socketRun(
        socket,
        {
          noteId,
          conversationId: threadId,
          content: body.prompt
        },
        signal
      )
  };
};

/**
 * Binds a transport to one note. After `setActive(false)` (note change or unmount) every pending or later call rejects
 * with an AbortError and open runs are aborted, so a late response from the previous note cannot reach the new one.
 */
export const scopeTransport = (inner: AssistantTransport, noteId: string) => {
  let active = true;
  const runs = new Set<AbortController>();
  const assertActive = () => {
    if (!active) {
      throw new DOMException('Notebook changed', 'AbortError');
    }
  };
  const guarded = async <T>(request: () => Promise<T>): Promise<T> => {
    assertActive();
    try {
      const result = await request();
      assertActive();
      return result;
    } catch (error) {
      assertActive();
      throw error;
    }
  };
  const transport: AssistantTransport = {
    listThreads: () => guarded(() => inner.listThreads({ noteId })),
    createThread: body => guarded(() => inner.createThread({ ...body, noteId })),
    deleteThread: id => guarded(() => inner.deleteThread(id)),
    getMessages: (id, before) => guarded(() => inner.getMessages(id, before)),
    async *openRun(id, body, signal) {
      assertActive();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
      }
      runs.add(controller);
      try {
        for await (const event of inner.openRun(id, body, controller.signal)) {
          assertActive();
          if (controller.signal.aborted) {
            throw new DOMException('Run stopped', 'AbortError');
          }
          yield event;
        }
      } catch (error) {
        assertActive();
        throw error;
      } finally {
        controller.abort();
        signal.removeEventListener('abort', abort);
        runs.delete(controller);
      }
    }
  };
  return {
    transport,
    setActive(next: boolean) {
      active = next;
      if (!next) {
        runs.forEach(controller => controller.abort());
        runs.clear();
      }
    }
  };
};
