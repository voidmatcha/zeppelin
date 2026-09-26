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

/**
 * Transport-neutral contract shared by the host and the assistant remote. Conversations and history come from REST
 * (JSON after unwrapping Zeppelin's response body); sending runs over the notebook WebSocket.
 */
export interface AssistantThread {
  id: string;
  title?: string;
  noteId?: string;
  /** Whether the requesting user can send messages to the conversation, as the server decides. */
  canSendMessage?: boolean;
}
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
export type AssistantEvent =
  | { type: 'run.started'; runId?: string }
  | { type: 'run.completed'; runId?: string }
  | { type: 'run.failed'; runId?: string; message: string }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.done'; messageId: string; content: string }
  | { type: 'tool_call.started'; toolCallId: string; name: string }
  // The server does not repeat the tool name on completion.
  | { type: 'tool_call.done'; toolCallId: string; name?: string };

/** Client → server payload of ASSISTANT_SEND_MESSAGE. */
export interface AssistantSendMessage {
  noteId: string;
  conversationId: string;
  content: string;
}

/** Server → client ASSISTANT_EVENT, sent only to the connection that sent the message. */
export interface AssistantSocketEvent {
  conversationId: string;
  type: string;
  payload?: Record<string, unknown>;
}

/** The host's notebook WebSocket, narrowed to the assistant ops. */
export interface AssistantSocket {
  send(message: AssistantSendMessage): void;
  subscribe(listener: (event: AssistantSocketEvent) => void): () => void;
}

export interface AssistantTransport {
  listThreads(scope?: { noteId?: string }): Promise<AssistantThread[]>;
  createThread(body: { noteId?: string; title?: string }): Promise<AssistantThread>;
  deleteThread(threadId: string): Promise<void>;
  /** The latest page of history, or the page before `before` (an `earlierCursor`; the panel does not page back yet). */
  getMessages(threadId: string, before?: string): Promise<AssistantMessagePage>;
  openRun(threadId: string, body: AssistantRunBody, signal: AbortSignal): AsyncIterable<AssistantEvent>;
}
