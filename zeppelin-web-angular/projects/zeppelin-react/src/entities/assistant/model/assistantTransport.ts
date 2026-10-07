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

import type { AssistantSendMessage, AssistantSocket, AssistantSocketEvent, AssistantToolDecision } from '@zeppelin/sdk';

/**
 * What the panel needs from the server. Conversations and history come from REST (JSON after unwrapping Zeppelin's
 * response body); sending runs over the host's notebook WebSocket.
 */
export interface AssistantConversation {
  id: string;
  title?: string;
  /** Account that created the conversation, shown as "Started by …". */
  ownerId?: string;
  /** Whether the requesting user can send messages to the conversation, as the server decides. */
  canSendMessage?: boolean;
  /** Last activity (ISO time), shown in the conversation list. */
  updatedAt?: string;
}
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** From history: the tools the server called before this answer. Live runs report them as events instead. */
  toolCalls?: AssistantToolCallRef[];
}
export interface AssistantToolCallRef {
  id: string;
  name: string;
}
/** One page of a conversation's history, oldest first. */
export interface AssistantMessagePage {
  messages: AssistantMessage[];
  /** Pass as `before` to load the page before this one; null when this page starts the conversation. */
  earlierCursor: string | null;
}
export interface AssistantRunBody {
  prompt: string;
}
export type AssistantRunEvent =
  | { type: 'run.started'; runId?: string }
  | { type: 'run.completed'; runId?: string }
  | { type: 'run.failed'; runId?: string; message: string }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.done'; messageId: string; content: string }
  | { type: 'tool_call.started'; toolCallId: string; name: string }
  // The server does not repeat the tool name on completion.
  | { type: 'tool_call.done'; toolCallId: string; name?: string }
  // Proposed with write tools: the tool waits until the owner allows or skips it.
  | { type: 'tool_call.approval_requested'; toolCallId: string; name: string; arguments: Record<string, unknown> };

export interface AssistantTransport {
  /** Conversations of the note the transport was created for. */
  listConversations(): Promise<AssistantConversation[]>;
  createConversation(body: { title?: string }): Promise<AssistantConversation>;
  deleteConversation(conversationId: string): Promise<void>;
  /** The latest page of history, or the page before `before` (an `earlierCursor`). */
  getMessages(conversationId: string, before?: string): Promise<AssistantMessagePage>;
  openRun(conversationId: string, body: AssistantRunBody, signal: AbortSignal): AsyncIterable<AssistantRunEvent>;
  decideToolCall(conversationId: string, toolCallId: string, decision: AssistantToolDecision['decision']): void;
}

const HTTP_MESSAGES: Record<number, string> = {
  403: 'You do not have permission for this conversation.',
  404: 'This conversation or note no longer exists.',
  409: 'This conversation is still answering. Try again when it finishes.',
  503: 'The assistant is not configured on this server. Ask an administrator to enable it.'
};

// run.failed carries only the HTTP status of the rejected or failed run, so the UI words it.
const RUN_ERROR_MESSAGES: Record<number, string> = {
  ...HTTP_MESSAGES,
  400: 'The assistant could not accept this message. Edit it and try again.',
  // Also returned when the user lost read access to the note, so it does not name the owner.
  403: 'You do not have permission to send messages to this conversation.'
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

/** The notebook WebSocket closed during a run; its events went with it, so only a reload shows where it got to. */
export class AssistantConnectionError extends Error {
  constructor() {
    super('The connection to the server was lost. Retry to reload the conversation and see where the answer got to.');
    this.name = 'AssistantConnectionError';
  }
}

/** An event this panel cannot read; the field stays on the error for debugging, the message is for the user. */
export class AssistantProtocolError extends Error {
  constructor(readonly detail: string) {
    super('The assistant sent a reply this panel could not read. Try again.');
    this.name = 'AssistantProtocolError';
  }
}

// The server sends no heartbeat, so a run that goes quiet this long is treated as lost.
const RUN_IDLE_TIMEOUT_MS = 180_000;

const optionalString = (data: Record<string, unknown>, field: string): string | undefined => {
  const value = data[field];
  if (value !== undefined && typeof value !== 'string') {
    throw new AssistantProtocolError(`Assistant event field "${field}" must be a string`);
  }
  return value;
};

const requiredString = (data: Record<string, unknown>, field: string): string => {
  const value = optionalString(data, field);
  if (value === undefined) {
    throw new AssistantProtocolError(`Assistant event field "${field}" is required`);
  }
  return value;
};

const errorMessage = (data: Record<string, unknown>): string => {
  const error = data.error;
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  return (typeof status === 'number' && RUN_ERROR_MESSAGES[status]) || RUN_ERROR_FALLBACK;
};

/** Maps an ASSISTANT_EVENT to the UI contract; unknown types map to undefined, so new server events are ignored. */
export const mapSocketEvent = ({ type, payload }: AssistantSocketEvent): AssistantRunEvent | undefined => {
  const data = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
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
    case 'tool_call.approval_requested': {
      const args = data.arguments;
      return {
        type,
        toolCallId: requiredString(data, 'toolCallId'),
        name: requiredString(data, 'name'),
        arguments: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
      };
    }
    default:
      return undefined;
  }
};

const isTerminal = (event: AssistantRunEvent): boolean => event.type === 'run.completed' || event.type === 'run.failed';

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string | null;
  toolCalls?: Array<{ id?: unknown; name?: unknown }> | null;
}

const toolCallRefs = (message: ConversationMessage): AssistantToolCallRef[] =>
  (message.toolCalls ?? []).flatMap(call =>
    typeof call?.id === 'string' && typeof call.name === 'string' ? [{ id: call.id, name: call.name }] : []
  );

const mergeAnswers = (earlier: AssistantMessage, later: AssistantMessage): AssistantMessage => {
  const toolCalls = Array.from(
    new Map([...(earlier.toolCalls ?? []), ...(later.toolCalls ?? [])].map(call => [call.id, call])).values()
  );
  return {
    ...later,
    content: [earlier.content, later.content].filter(Boolean).join('\n\n'),
    ...(toolCalls.length ? { toolCalls } : {})
  };
};

/**
 * One bubble per turn: tool and system messages are hidden, tool rounds merge under the last message's id, and
 * the tools called on the way are kept on the answer so a reopened conversation still shows its action log.
 */
export const toVisibleMessages = (messages: ConversationMessage[]): AssistantMessage[] => {
  const visible: AssistantMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      visible.push({ id: message.id, role: 'user', content: message.content ?? '' });
    } else if (message.role === 'assistant') {
      const toolCalls = toolCallRefs(message);
      // Keep a tool-only turn even when its answer is on a later page or has not arrived yet.
      if (!message.content && !toolCalls.length) continue;
      const last = visible[visible.length - 1];
      const answer: AssistantMessage = {
        id: message.id,
        role: 'assistant',
        content: message.content ?? '',
        ...(toolCalls.length ? { toolCalls } : {})
      };
      if (last?.role === 'assistant') visible[visible.length - 1] = mergeAnswers(last, answer);
      else visible.push(answer);
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

const MAX_ABANDONED_RUNS = 200;
/**
 * Runs seen across one note's sends. `abandoned`: aborted by a conversation switch; the server finishes them, so later
 * runs skip their events. Capped, since an id is otherwise dropped only when its terminal event is seen.
 */
export interface RunTracking {
  abandoned: Set<string>;
  decisionListeners: Set<(conversationId: string, toolCallId: string) => void>;
}
export const createRunTracking = (): RunTracking => ({ abandoned: new Set(), decisionListeners: new Set() });

/**
 * Sends one message over the host's notebook WebSocket and yields that conversation's events until a terminal one.
 * Until this message's run.started arrives, only a rejection (run.failed) belongs to it; events of an abandoned run
 * on the same conversation are skipped.
 */
export async function* socketRun(
  socket: AssistantSocket,
  message: AssistantSendMessage,
  signal: AbortSignal,
  { abandoned, decisionListeners }: RunTracking,
  idleTimeoutMs = RUN_IDLE_TIMEOUT_MS
): AsyncIterable<AssistantRunEvent> {
  signal.throwIfAborted();
  const queue: Array<AssistantRunEvent | Error> = [];
  let wake: (() => void) | undefined;
  const push = (item: AssistantRunEvent | Error) => {
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
  const unsubscribeClose = socket.subscribeClose(() => push(new AssistantConnectionError()));
  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort, { once: true });
  let started = false;
  let ownRunId: string | undefined;
  let ended = false;
  // The server is silent while a tool waits for the user's answer, so silence then is not a lost run.
  const awaitingApprovals = new Set<string>();
  const onDecision = (conversationId: string, toolCallId: string) => {
    if (conversationId === message.conversationId && awaitingApprovals.delete(toolCallId)) wake?.();
  };
  decisionListeners.add(onDecision);
  try {
    socket.send(message);
    while (true) {
      signal.throwIfAborted();
      if (queue.length === 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>(resolve => {
          wake = resolve;
          if (awaitingApprovals.size === 0) timer = setTimeout(() => push(new AssistantStreamError()), idleTimeoutMs);
        });
        clearTimeout(timer);
        wake = undefined;
      }
      signal.throwIfAborted();
      const item = queue.shift();
      if (item === undefined) continue;
      if (item instanceof Error) throw item;
      const runId = 'runId' in item ? item.runId : undefined;
      if (runId && runId !== ownRunId && abandoned.has(runId)) {
        if (isTerminal(item)) abandoned.delete(runId);
        continue;
      }
      // Once running, only its own terminal event ends it; deltas have no run id, but runs are one at a time.
      if (started && isTerminal(item) && runId && ownRunId && runId !== ownRunId) continue;
      if (!started) {
        if (item.type === 'run.started') {
          started = true;
          ownRunId = item.runId;
        } else if (item.type !== 'run.failed') continue;
      }
      if (item.type === 'tool_call.approval_requested') awaitingApprovals.add(item.toolCallId);
      else if (item.type === 'tool_call.done') awaitingApprovals.delete(item.toolCallId);
      if (isTerminal(item)) ended = true;
      yield item;
      if (ended) return;
    }
  } finally {
    // Aborted after the server started it: the run continues server-side.
    if (started && !ended && ownRunId) {
      abandoned.add(ownRunId);
      if (abandoned.size > MAX_ABANDONED_RUNS) abandoned.delete(abandoned.values().next().value!);
    }
    decisionListeners.delete(onDecision);
    signal.removeEventListener('abort', onAbort);
    unsubscribe();
    unsubscribeClose();
  }
}

type ConversationSummary = {
  id: string;
  title?: string;
  ownerId?: string;
  canSendMessage?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
type MessagePage = { messages: ConversationMessage[]; cursor?: string | null };

// One page of raw server messages; the panel loads earlier pages as the user scrolls up.
const HISTORY_PAGE_SIZE = 50;

/**
 * Puts an earlier page in front of the loaded history. A turn split across the page boundary
 * becomes one bubble again, under the later id as in `toVisibleMessages`.
 */
export const joinPages = (earlier: AssistantMessage[], later: AssistantMessage[]): AssistantMessage[] => {
  const last = earlier[earlier.length - 1];
  const first = later[0];
  if (last?.role === 'assistant' && first?.role === 'assistant') {
    return [...earlier.slice(0, -1), mergeAnswers(last, first), ...later.slice(1)];
  }
  return [...earlier, ...later];
};

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
  const runs = createRunTracking();
  const toConversation = (conversation: ConversationSummary): AssistantConversation => ({
    id: conversation.id,
    title: conversation.title,
    ...(conversation.ownerId !== undefined ? { ownerId: conversation.ownerId } : {}),
    ...(typeof conversation.canSendMessage === 'boolean' ? { canSendMessage: conversation.canSendMessage } : {}),
    ...((conversation.updatedAt ?? conversation.createdAt)
      ? { updatedAt: conversation.updatedAt ?? conversation.createdAt }
      : {})
  });
  // The server names an untitled conversation by its creation time.
  const titleFor = (title?: string) => {
    const trimmed = title?.trim().replace(/\s+/g, ' ');
    return trimmed ? { title: trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed } : {};
  };
  return {
    // Latest activity first, so the panel opens on it; undated ones stay last in server order (stable sort).
    listConversations: async () =>
      (await collectionRequest<ConversationSummary[]>(base, {}, onAuthError))
        .map(conversation => ({
          conversation,
          time: Date.parse(conversation.updatedAt ?? conversation.createdAt ?? '') || 0
        }))
        .sort((a, b) => b.time - a.time)
        .map(({ conversation }) => toConversation(conversation)),
    createConversation: async ({ title } = {}) =>
      toConversation(
        await collectionRequest<ConversationSummary>(base, { method: 'POST', body: titleFor(title) }, onAuthError)
      ),
    deleteConversation: async conversationId => {
      await requestJson<void>(`${base}/${encodeURIComponent(conversationId)}`, { method: 'DELETE' }, onAuthError);
    },
    decideToolCall: (conversationId, toolCallId, decision) => {
      socket.decide({ noteId, conversationId, toolCallId, decision });
      // Start listening for server progress again only after the last pending decision was sent successfully.
      runs.decisionListeners.forEach(listener => listener(conversationId, toolCallId));
    },
    getMessages: async (conversationId, before): Promise<AssistantMessagePage> => {
      const cursor = before ? `&cursor=${encodeURIComponent(before)}` : '';
      const page = await requestJson<MessagePage>(
        `${base}/${encodeURIComponent(conversationId)}/messages?limit=${HISTORY_PAGE_SIZE}${cursor}`,
        {},
        onAuthError
      );
      // The server pages from the latest message backwards; the panel renders oldest to newest.
      return { messages: toVisibleMessages([...page.messages].reverse()), earlierCursor: page.cursor ?? null };
    },
    openRun: (conversationId, body, signal) =>
      socketRun(
        socket,
        {
          noteId,
          conversationId,
          content: body.prompt
        },
        signal,
        runs
      )
  };
};

/**
 * Guards a per-note transport. After `setActive(false)` (note change or unmount) every pending or later call rejects
 * with an AbortError and open runs are aborted, so a late response from the previous note cannot reach the new one.
 */
export const scopeTransport = (inner: AssistantTransport) => {
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
    listConversations: () => guarded(() => inner.listConversations()),
    createConversation: body => guarded(() => inner.createConversation(body)),
    deleteConversation: id => guarded(() => inner.deleteConversation(id)),
    decideToolCall: (id, toolCallId, decision) => {
      assertActive();
      inner.decideToolCall(id, toolCallId, decision);
    },
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
