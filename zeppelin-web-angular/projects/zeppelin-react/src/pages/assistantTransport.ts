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
  AssistantContext,
  AssistantEvent,
  AssistantMessage,
  AssistantThread,
  AssistantTransport
} from '@zeppelin/sdk';

export class AssistantHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly location: string | null
  ) {
    super(`Assistant request failed with HTTP ${status}`);
    this.name = 'AssistantHttpError';
  }
}

export class AssistantStreamError extends Error {
  readonly retryable = true;

  constructor() {
    super('Assistant stream ended before a terminal event. Retry the request.');
    this.name = 'AssistantStreamError';
  }
}

const requireObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Assistant event data must be a JSON object');
  }
  return value as Record<string, unknown>;
};

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

/** One SSE frame as sent, before mapping it to an AssistantEvent. */
export interface RawAssistantEvent {
  name: string;
  data: Record<string, unknown>;
}

const readFrame = (frame: string): RawAssistantEvent | undefined => {
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line.startsWith(':')) {
      continue;
    }
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (eventName === undefined && dataLines.length === 0) {
    return undefined;
  }
  if (eventName === undefined) {
    throw new Error('Assistant SSE frame is missing an event name');
  }

  let rawData: unknown = {};
  if (dataLines.length > 0) {
    try {
      rawData = JSON.parse(dataLines.join('\n')) as unknown;
    } catch {
      throw new Error(`Assistant event "${eventName}" has invalid JSON data`);
    }
  }
  return { name: eventName, data: requireObject(rawData) };
};

// JSON null means "absent" for optional fields.
const nullableString = (data: Record<string, unknown>, field: string): string | undefined =>
  data[field] === null ? undefined : optionalString(data, field);

const errorMessage = (data: Record<string, unknown>): string => {
  const error = data.error;
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return optionalString(data, 'message') ?? 'The assistant request failed.';
};

/** Maps the conversation API's snake_case events to the UI contract. */
const mapConversationEvent = ({ name, data }: RawAssistantEvent): AssistantEvent | undefined => {
  switch (name) {
    case 'run.started':
      return { type: name, runId: optionalString(data, 'run_id') };
    case 'run.heartbeat':
    case 'run.completed':
      return { type: name };
    case 'run.failed':
    case 'error':
      return { type: name, message: errorMessage(data) };
    case 'message.delta':
      return { type: name, messageId: requiredString(data, 'message_id'), delta: requiredString(data, 'delta') };
    case 'message.done':
      return { type: name, messageId: requiredString(data, 'message_id'), content: requiredString(data, 'content') };
    case 'tool_call.started':
    case 'tool_call.done':
      return { type: name, toolCallId: requiredString(data, 'tool_call_id'), name: requiredString(data, 'name') };
    case 'proposal.created': {
      const target: AssistantContext['target'] =
        data.kind === 'insert'
          ? { kind: 'insert', afterParagraphId: nullableString(data, 'after_paragraph_id') ?? null }
          : { kind: 'paragraph', paragraphId: requiredString(data, 'paragraph_id') };
      return {
        type: name,
        target,
        originalText: nullableString(data, 'original_text'),
        code: requiredString(data, 'text')
      };
    }
    case 'ui.reveal':
      return { type: name, paragraphId: requiredString(data, 'paragraph_id') };
    default:
      return undefined;
  }
};

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string | null;
}

/** Shows one bubble per turn: tool and system messages stay hidden, tool rounds are merged. */
export const toVisibleMessages = (messages: ConversationMessage[]): AssistantMessage[] => {
  const visible: AssistantMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      visible.push({ id: message.id, role: 'user', content: message.content ?? '' });
    } else if (message.role === 'assistant' && message.content) {
      const last = visible[visible.length - 1];
      if (last?.role === 'assistant') {
        last.content += message.content;
      } else {
        visible.push({ id: message.id, role: 'assistant', content: message.content });
      }
    }
  }
  return visible;
};

const takeFrame = (buffer: string): { frame: string; rest: string } | undefined => {
  const boundary = /\r\n\r\n|\n\n/.exec(buffer);
  if (boundary?.index === undefined) {
    return undefined;
  }
  return {
    frame: buffer.slice(0, boundary.index),
    rest: buffer.slice(boundary.index + boundary[0].length)
  };
};

const requestHeaders = {
  // Zeppelin's shell sends this on every request so the server answers 401/405 instead of a login page.
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

type ConversationSummary = { id: string; title?: string; note_id?: string };

/** Transport for the server's per-note conversation API. `apiBase` is the host's REST base, e.g. `.../api`. */
export const createAssistantTransport = (
  apiBase: string,
  noteId: string,
  onAuthError?: AssistantAuthErrorHandler
): AssistantTransport => {
  const base = `${apiBase.replace(/\/$/, '')}/notes/${encodeURIComponent(noteId)}/conversations`;
  const toThread = (conversation: ConversationSummary): AssistantThread => ({
    id: conversation.id,
    title: conversation.title,
    noteId: conversation.note_id ?? noteId
  });
  return {
    listThreads: async () => (await requestJson<ConversationSummary[]>(base, {}, onAuthError)).map(toThread),
    createThread: async () =>
      toThread(
        await requestJson<ConversationSummary>(
          base,
          { method: 'POST', body: { title: 'New conversation' } },
          onAuthError
        )
      ),
    deleteThread: async threadId => {
      await requestJson<void>(`${base}/${encodeURIComponent(threadId)}`, { method: 'DELETE' }, onAuthError);
    },
    getMessages: async threadId =>
      toVisibleMessages(
        await requestJson<ConversationMessage[]>(`${base}/${encodeURIComponent(threadId)}/messages`, {}, onAuthError)
      ),
    openRun: (threadId, body, signal) =>
      streamRun(
        `${base}/${encodeURIComponent(threadId)}/messages`,
        {
          content: body.prompt,
          context: {
            activeParagraphId: body.activeParagraphId,
            target: body.context?.target,
            originalText: body.context?.originalText
          }
        },
        signal,
        onAuthError
      )
  };
};

async function* streamRun(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onAuthError?: AssistantAuthErrorHandler
): AsyncIterable<AssistantEvent> {
  signal.throwIfAborted();
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...requestHeaders
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    throw httpError(response, onAuthError);
  }
  if (response.body === null) {
    throw new Error('Assistant run response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  let terminalEventReceived = false;
  const cancelOnAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancelOnAbort, { once: true });

  try {
    signal.throwIfAborted();
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) {
        finished = true;
        buffer += decoder.decode();
        if (signal.aborted) {
          throw signal.reason;
        }
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });

      let part = takeFrame(buffer);
      while (part !== undefined) {
        buffer = part.rest;
        const raw = readFrame(part.frame);
        // Unknown event types map to undefined and are skipped, so additive server
        // events do not break an older UI.
        const event = raw === undefined ? undefined : mapConversationEvent(raw);
        if (event !== undefined) {
          terminalEventReceived =
            terminalEventReceived ||
            event.type === 'run.completed' ||
            event.type === 'run.failed' ||
            event.type === 'error';
          signal.throwIfAborted();
          yield event;
        }
        part = takeFrame(buffer);
      }
    }
    if (!terminalEventReceived) {
      throw new AssistantStreamError();
    }
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    if (!finished) {
      try {
        await reader.cancel();
      } catch {
        // The abort/error that ended the stream is the useful error for the caller.
      }
    }
    reader.releaseLock();
  }
}

/**
 * Binds a transport to one note. After `setActive(false)` (note change or unmount) every pending or
 * later call rejects with an AbortError and open runs are aborted, so a late response from the
 * previous note cannot reach the new one.
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
    createThread: () => guarded(() => inner.createThread({ noteId })),
    deleteThread: id => guarded(() => inner.deleteThread(id)),
    getMessages: id => guarded(() => inner.getMessages(id)),
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
        for await (const event of inner.openRun(id, { ...body, noteId }, controller.signal)) {
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
