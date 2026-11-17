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

import type { AssistantEvent, AssistantSendMessage } from './interfaces/message-assistant.interface';

/** ASSISTANT_EVENT with the request identifier from its WebSocket envelope. */
export type AssistantSocketEvent = AssistantEvent & {
  /** The echoed envelope msgId; undefined is a protocol error, never a wildcard. */
  requestId: string | undefined;
};

/** The host's notebook WebSocket, narrowed to the assistant ops. */
export interface AssistantSocket {
  /** Returns the outgoing envelope msgId used to correlate every response. */
  send(message: AssistantSendMessage): string;
  subscribe(listener: (event: AssistantSocketEvent) => void): () => void;
  /** The connection closed. The server sends a run's events only to the connection that started it. */
  subscribeClose(listener: () => void): () => void;
}

/** The host rejected a send before dispatching it to the notebook WebSocket. */
export class AssistantNotSentError extends Error {
  constructor() {
    super('The assistant is not connected. Reconnect and send your question again.');
    this.name = 'AssistantNotSentError';
  }

  static is(error: unknown): error is Error {
    // The host and React remote bundle the SDK separately, so constructor identity is not shared.
    return error instanceof Error && error.name === 'AssistantNotSentError';
  }
}
