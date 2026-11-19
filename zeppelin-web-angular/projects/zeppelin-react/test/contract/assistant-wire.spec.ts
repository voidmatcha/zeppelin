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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantProtocolError,
  createAssistantConversationApi,
  mapSocketEvent
} from '../../src/entities/assistant/model/assistantTransport';

// Deliberately no fallback fixture: a missing provider build must fail the check.
const fixtures = JSON.parse(
  readFileSync(
    resolve(process.env.ASSISTANT_CONTRACT_FIXTURE ?? '../zeppelin-server/target/assistant-contract/wire.json'),
    'utf8'
  )
);
const api = createAssistantConversationApi('/api', 'note');
const respond = (value: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status: 200 })));
afterEach(() => vi.unstubAllGlobals());

describe('Java provider to Assistant consumer contract', () => {
  it('reads owner and reader permissions and a server-generated title', async () => {
    respond(fixtures.conversations);
    const conversations = await api.listConversations();
    expect(conversations.map(item => item.canSendMessage)).toEqual([true, false]);
    expect(conversations[0].title).toEqual(expect.any(String));
    respond(fixtures.createdConversation);
    expect(await api.createConversation({})).toEqual(conversations[0]);
  });

  it('reads omitted nulls, tool-only turns, reverse history, and pagination', async () => {
    respond(fixtures.history);
    const page = await api.getMessages('conversation');
    expect(page.cursor).toBeNull();
    expect(page.messages).toEqual([
      { id: 'question', role: 'user', content: 'Question' },
      {
        id: 'answer',
        role: 'assistant',
        segments: [
          { id: 'tool-answer', content: '', toolCalls: [{ id: 'call', name: 'get_note' }] },
          { id: 'answer', content: 'Answer' }
        ]
      }
    ]);
    respond(fixtures.olderHistory);
    expect(await api.getMessages('conversation', 'cursor')).toEqual({ messages: [], cursor: 'cursor' });
  });

  it('maps every current Java event and its required identifiers', () => {
    const mapped = fixtures.events.map((event: { op: string; data: Parameters<typeof mapSocketEvent>[0] }) => {
      expect(event.op).toBe('ASSISTANT_EVENT');
      return mapSocketEvent(event.data);
    });
    expect(mapped).toEqual([
      { type: 'run.started', runId: 'run' },
      { type: 'message.delta', messageId: 'answer', delta: 'Answer' },
      { type: 'message.done', messageId: 'answer', content: 'Answer' },
      { type: 'tool_call.started', toolCallId: 'call', name: 'get_note' },
      { type: 'tool_call.done', toolCallId: 'call' },
      { type: 'run.completed', runId: 'run' },
      { type: 'run.failed', runId: 'run', message: 'This conversation is still answering. Try again when it finishes.' }
    ]);
  });

  it.each(['id', 'title', 'ownerId', 'canSendMessage', 'updatedAt'])('rejects missing metadata %s', async field => {
    const response = structuredClone(fixtures.createdConversation);
    delete response.body[field];
    respond(response);
    await expect(api.createConversation({})).rejects.toBeInstanceOf(AssistantProtocolError);
  });

  it('rejects a string permission instead of granting access through truthiness', async () => {
    const response = structuredClone(fixtures.createdConversation);
    response.body.canSendMessage = 'false';
    respond(response);
    await expect(api.createConversation({})).rejects.toBeInstanceOf(AssistantProtocolError);
  });

  it.each([
    [
      'numeric content',
      (body: Record<string, unknown>) => {
        body.messages = [{ id: 'm', role: 'assistant', content: 42 }];
      }
    ],
    [
      'unknown role',
      (body: Record<string, unknown>) => {
        body.messages = [{ id: 'm', role: 'unknown' }];
      }
    ],
    [
      'missing id',
      (body: Record<string, unknown>) => {
        body.messages = [{ role: 'assistant', content: 'Answer' }];
      }
    ],
    [
      'non-array messages',
      (body: Record<string, unknown>) => {
        body.messages = {};
      }
    ],
    [
      'invalid cursor',
      (body: Record<string, unknown>) => {
        body.cursor = false;
      }
    ],
    [
      'invalid tool call',
      (body: Record<string, unknown>) => {
        body.messages = [{ id: 'm', role: 'assistant', toolCalls: [{}] }];
      }
    ]
  ])('rejects malformed history: %s', async (_name, mutate) => {
    const response = structuredClone(fixtures.history);
    mutate(response.body);
    respond(response);
    await expect(api.getMessages('conversation')).rejects.toBeInstanceOf(AssistantProtocolError);
  });

  it('accepts explicit null content and cursor as well as omitted nulls', async () => {
    const response = structuredClone(fixtures.history);
    response.body.cursor = null;
    response.body.messages[2].content = null;
    respond(response);
    const page = await api.getMessages('conversation');
    expect(page.cursor).toBeNull();
    expect(page.messages).toHaveLength(2);
  });

  it.each(['run.started', 'run.completed', 'run.failed'] as const)('rejects missing runId in %s', type => {
    expect(() => mapSocketEvent({ conversationId: 'conversation', type, payload: {} })).toThrow(AssistantProtocolError);
  });

  it('accepts additive server fields', async () => {
    const response = structuredClone(fixtures.createdConversation);
    response.body.futureField = true;
    respond(response);
    expect((await api.createConversation({})).id).toBe(response.body.id);
  });
});
