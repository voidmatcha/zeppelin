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
import Ajv2020 from 'ajv/dist/2020';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantSocket, AssistantSocketEvent } from '@zeppelin/sdk';
import {
  AssistantProtocolError,
  createAssistantConversationApi,
  mapSocketEvent,
  socketRun
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

  it('normalizes optional persisted display metadata after the storage codec and REST serializer', async () => {
    expect(fixtures.sparseConversations).toHaveLength(2);
    for (const response of fixtures.sparseConversations) {
      respond(response);
      const conversation = await api.createConversation({});
      expect(conversation.title).toBe('');
      expect(conversation.updatedAt).toBe(response.body.createdAt);
    }
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

  it('reads a real persisted tool round and final answer from AssistantImpl', async () => {
    respond(fixtures.produced.history);
    const page = await api.getMessages('conversation');
    expect(page.cursor).toBeNull();
    expect(page.messages).toEqual([
      { id: expect.any(String), role: 'user', content: 'Produced question' },
      {
        id: expect.any(String),
        role: 'assistant',
        segments: [
          { id: expect.any(String), content: '', toolCalls: [{ id: 'produced-call', name: 'list_paragraphs' }] },
          { id: expect.any(String), content: 'Produced answer' }
        ]
      }
    ]);
    const events: Array<{ data: AssistantSocketEvent }> = fixtures.produced.events;
    const mapped = events.map(event => mapSocketEvent(event.data));
    expect(mapped).toEqual([
      { type: 'run.started', runId: expect.any(String) },
      { type: 'tool_call.started', toolCallId: 'produced-call', name: 'list_paragraphs' },
      { type: 'tool_call.done', toolCallId: 'produced-call' },
      { type: 'message.delta', messageId: expect.any(String), delta: 'Produced answer' },
      { type: 'message.done', messageId: expect.any(String), content: 'Produced answer' },
      { type: 'run.completed', runId: expect.any(String) },
      {
        type: 'run.failed',
        runId: expect.any(String),
        message: 'The assistant could not accept this message. Edit it and try again.'
      }
    ]);
    const answer = page.messages[1];
    const finalId = answer.role === 'assistant' ? answer.segments[answer.segments.length - 1].id : undefined;
    expect(answer.id).toBe(finalId);
    expect(
      mapped
        .filter(event => event?.type === 'message.delta' || event?.type === 'message.done')
        .map(event => event.messageId)
    ).toEqual([finalId, finalId]);
    const started = mapped[0];
    const completed = mapped.find(event => event?.type === 'run.completed');
    expect(started && 'runId' in started ? started.runId : undefined).toBe(
      completed && 'runId' in completed ? completed.runId : undefined
    );
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

  it.each(['completed', 'failed'] as const)('routes the production socket envelope through a %s run', async outcome => {
    const events: Array<{ op: string; data: AssistantSocketEvent }> = fixtures.events;
    let listener: ((event: AssistantSocketEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const unsubscribeClose = vi.fn();
    const socket: AssistantSocket = {
      subscribe: callback => {
        listener = callback;
        return unsubscribe;
      },
      subscribeClose: () => unsubscribeClose,
      send: () => {
        for (const { data } of events) {
          listener?.({ ...data, conversationId: 'another-conversation' });
          if (data.type !== `run.${outcome === 'completed' ? 'failed' : 'completed'}`) listener?.(data);
        }
      }
    };
    const received = [];
    for await (const event of socketRun(
      socket,
      { noteId: 'note', conversationId: 'conversation', content: 'Question' },
      new AbortController().signal,
      100
    )) {
      received.push(event);
    }
    expect(received.map(event => event.type)).toEqual([
      'run.started',
      'message.delta',
      'message.done',
      'tool_call.started',
      'tool_call.done',
      `run.${outcome}`
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribeClose).toHaveBeenCalledOnce();
  });

  it.each(['id', 'ownerId', 'canSendMessage'])('rejects missing metadata %s', async field => {
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

// OpenAPI 3.1 uses JSON Schema 2020-12. Validate real resource entities, not hand-built envelopes.
describe('Assistant OpenAPI resource contract', () => {
  const document = JSON.parse(readFileSync('../zeppelin-server/target/assistant-contract/openapi.json', 'utf8'));
  const exchanges: Array<{ operationId: string; status: number; body?: unknown }> = JSON.parse(
    readFileSync('../zeppelin-server/target/assistant-contract/rest-exchanges.json', 'utf8')
  );
  const operations = Object.values(document.paths).flatMap(path =>
    Object.values(path as Record<string, { operationId: string; responses: Record<string, unknown> }>)
  );
  // Keep the public schema additive-compatible, but detect Gson/Jackson field-name drift
  // in known provider objects. Dictionaries and arbitrary JSON remain open.
  const providerDocument = structuredClone(document);
  for (const schema of Object.values(providerDocument.components.schemas) as Array<Record<string, unknown>>) {
    if (schema.properties) schema.additionalProperties = false;
  }
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const metadata = ajv.compile({
    $ref: '#/components/schemas/AssistantConversationMetadataResponse',
    components: document.components
  });

  it('covers every described resource operation with its actual HTTP status', () => {
    expect(new Set(exchanges.map(exchange => exchange.operationId))).toEqual(
      new Set(operations.map(operation => operation.operationId))
    );
    for (const exchange of exchanges) {
      const operation = operations.find(operation => operation.operationId === exchange.operationId)!;
      expect(operation.responses[String(exchange.status)]).toBeDefined();
    }
  });

  it.each(exchanges)('$operationId returns an entity matching its response schema', exchange => {
    const operation = operations.find(operation => operation.operationId === exchange.operationId)!;
    const response = operation.responses[String(exchange.status)] as {
      content: { 'application/json': { schema: object } };
    };
    const schema = response.content?.['application/json']?.schema;
    expect(Object.hasOwn(exchange, 'body')).toBe(Boolean(schema));
    if (!schema) return;
    const validate = ajv.compile({
      ...response.content['application/json'].schema,
      components: providerDocument.components
    });
    expect({ valid: validate(exchange.body), errors: validate.errors }).toEqual({ valid: true, errors: null });
  });

  it('deletes with HTTP 204 and no response entity', () => {
    expect(exchanges.find(exchange => exchange.operationId === 'deleteAssistantConversation')).toEqual({
      operationId: 'deleteAssistantConversation',
      status: 204
    });
  });

  it.each([
    {
      operationId: 'listAssistantConversations',
      response: fixtures.conversations,
      send: () => api.listConversations()
    },
    {
      operationId: 'createAssistantConversation',
      response: fixtures.createdConversation,
      send: () => api.createConversation({ title: null })
    },
    {
      operationId: 'listAssistantMessages',
      response: fixtures.history,
      send: () => api.getMessages('conversation', 'cursor')
    },
    {
      operationId: 'deleteAssistantConversation',
      response: undefined,
      send: () => api.deleteConversation('conversation')
    }
  ])('$operationId sends a request matching the described route, method, and JSON body', async test => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(test.response === undefined ? null : JSON.stringify(test.response), {
          status: test.response === undefined ? 204 : 200
        })
      )
    );
    await test.send();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    const request = new URL(String(url), 'http://zeppelin.test');
    const match = Object.entries(document.paths)
      .flatMap(([path, methods]) =>
        Object.entries(
          methods as Record<
            string,
            {
              operationId: string;
              requestBody?: { content: { 'application/json': { schema: object } } };
              parameters: Array<{ in: string; name: string; required?: boolean; schema: { type: string } }>;
            }
          >
        ).map(([method, operation]) => ({ path, method, operation }))
      )
      .find(({ operation }) => operation.operationId === test.operationId)!;
    expect(init?.method?.toLowerCase()).toBe(match.method);
    expect(request.pathname.replace(/^\/api/, '')).toBe(
      match.path.replace('{noteId}', 'note').replace('{conversationId}', 'conversation')
    );
    const queryParameters = match.operation.parameters.filter(
      parameter => parameter.in === 'query' && (parameter.required || request.searchParams.has(parameter.name))
    );
    for (const parameter of queryParameters) {
      const value = request.searchParams.get(parameter.name);
      const validate = ajv.compile(parameter.schema);
      expect(validate(parameter.schema.type === 'integer' ? Number(value) : value)).toBe(true);
    }
    request.searchParams.forEach((_value, name) => {
      expect(match.operation.parameters.some(parameter => parameter.in === 'query' && parameter.name === name)).toBe(
        true
      );
    });
    const validate = ajv.compile({
      ...(match.operation.requestBody?.content['application/json'].schema ?? {}),
      components: document.components
    });
    expect(validate(init?.body ? JSON.parse(String(init.body)) : undefined)).toBe(true);
  });

  it('accepts omitted persisted display metadata in the generated response schema', () => {
    expect(fixtures.sparseConversations).toHaveLength(2);
    for (const response of fixtures.sparseConversations) {
      expect({ valid: metadata(response), errors: metadata.errors }).toEqual({ valid: true, errors: null });
    }
  });

  it('accepts stored messages without timestamps or tool arguments', async () => {
    const validate = ajv.compile({
      $ref: '#/components/schemas/AssistantMessageListResponse',
      components: document.components
    });
    expect({ valid: validate(fixtures.sparseHistory), errors: validate.errors }).toEqual({ valid: true, errors: null });
    respond(fixtures.sparseHistory);
    const sparse = await api.getMessages('conversation');
    respond(fixtures.history);
    expect(sparse).toEqual(await api.getMessages('conversation'));
  });

  it('rejects a missing permission and a permission serialized as text', () => {
    const response = structuredClone(fixtures.createdConversation);
    delete response.body.canSendMessage;
    expect(metadata(response)).toBe(false);
    response.body.canSendMessage = 'true';
    expect(metadata(response)).toBe(false);
  });

  it('distinguishes optional nullable creation titles from required rename titles', () => {
    const create = ajv.compile({
      $ref: '#/components/schemas/AssistantConversationRequest',
      components: document.components
    });
    const rename = ajv.compile({
      $ref: '#/components/schemas/AssistantRenameConversationRequest',
      components: document.components
    });
    expect(create({})).toBe(true);
    expect(create({ title: null })).toBe(true);
    expect(rename({})).toBe(false);
    expect(rename({ title: null })).toBe(false);
    expect(rename({ title: '' })).toBe(false);
    expect(rename({ title: 'Renamed' })).toBe(true);
  });
});
