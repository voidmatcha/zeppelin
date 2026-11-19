/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Generated from the Java Assistant REST resources. Do not edit.
export interface paths {
  '/notes/{noteId}/conversations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listAssistantConversations'];
    put?: never;
    post: operations['createAssistantConversation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/notes/{noteId}/conversations/{conversationId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getAssistantConversation'];
    put?: never;
    post?: never;
    delete: operations['deleteAssistantConversation'];
    options?: never;
    head?: never;
    patch: operations['renameAssistantConversation'];
    trace?: never;
  };
  '/notes/{noteId}/conversations/{conversationId}/messages': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listAssistantMessages'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    AssistantConversationRequest: {
      title?: string | null;
    };
    AssistantConversationMetadata: {
      id: string;
      noteId: string;
      ownerId: string;
      title?: string;
      createdAt: string;
      updatedAt?: string;
      canSendMessage: boolean;
    };
    AssistantConversationMetadataResponse: {
      /** @enum {string} */
      status:
        | 'OK'
        | 'CREATED'
        | 'ACCEPTED'
        | 'NO_CONTENT'
        | 'RESET_CONTENT'
        | 'PARTIAL_CONTENT'
        | 'MULTIPLE_CHOICES'
        | 'MOVED_PERMANENTLY'
        | 'FOUND'
        | 'SEE_OTHER'
        | 'NOT_MODIFIED'
        | 'USE_PROXY'
        | 'TEMPORARY_REDIRECT'
        | 'PERMANENT_REDIRECT'
        | 'BAD_REQUEST'
        | 'UNAUTHORIZED'
        | 'PAYMENT_REQUIRED'
        | 'FORBIDDEN'
        | 'NOT_FOUND'
        | 'METHOD_NOT_ALLOWED'
        | 'NOT_ACCEPTABLE'
        | 'PROXY_AUTHENTICATION_REQUIRED'
        | 'REQUEST_TIMEOUT'
        | 'CONFLICT'
        | 'GONE'
        | 'LENGTH_REQUIRED'
        | 'PRECONDITION_FAILED'
        | 'REQUEST_ENTITY_TOO_LARGE'
        | 'REQUEST_URI_TOO_LONG'
        | 'UNSUPPORTED_MEDIA_TYPE'
        | 'REQUESTED_RANGE_NOT_SATISFIABLE'
        | 'EXPECTATION_FAILED'
        | 'PRECONDITION_REQUIRED'
        | 'TOO_MANY_REQUESTS'
        | 'REQUEST_HEADER_FIELDS_TOO_LARGE'
        | 'UNAVAILABLE_FOR_LEGAL_REASONS'
        | 'INTERNAL_SERVER_ERROR'
        | 'NOT_IMPLEMENTED'
        | 'BAD_GATEWAY'
        | 'SERVICE_UNAVAILABLE'
        | 'GATEWAY_TIMEOUT'
        | 'HTTP_VERSION_NOT_SUPPORTED'
        | 'NETWORK_AUTHENTICATION_REQUIRED';
      message?: string;
      body: components['schemas']['AssistantConversationMetadata'];
    };
    AssistantUserMessage: {
      id: string;
      createdAt?: string;
      /** @enum {string} */
      role: 'user';
      content?: string;
    };
    AssistantAnswerMessage: {
      id: string;
      createdAt?: string;
      /** @enum {string} */
      role: 'assistant';
      content?: string;
      toolCalls?: components['schemas']['AssistantToolCall'][];
    };
    AssistantToolCall: {
      id: string;
      name: string;
      arguments?: {
        [key: string]: unknown;
      };
      result?: components['schemas']['ToolResult'];
    };
    ToolResult: {
      value?: unknown;
      error?: string;
    };
    AssistantToolMessage: {
      id: string;
      createdAt?: string;
      /** @enum {string} */
      role: 'tool';
      toolCallId?: string;
      content?: string;
    };
    AssistantConversationDetailResponse: {
      /** @enum {string} */
      status:
        | 'OK'
        | 'CREATED'
        | 'ACCEPTED'
        | 'NO_CONTENT'
        | 'RESET_CONTENT'
        | 'PARTIAL_CONTENT'
        | 'MULTIPLE_CHOICES'
        | 'MOVED_PERMANENTLY'
        | 'FOUND'
        | 'SEE_OTHER'
        | 'NOT_MODIFIED'
        | 'USE_PROXY'
        | 'TEMPORARY_REDIRECT'
        | 'PERMANENT_REDIRECT'
        | 'BAD_REQUEST'
        | 'UNAUTHORIZED'
        | 'PAYMENT_REQUIRED'
        | 'FORBIDDEN'
        | 'NOT_FOUND'
        | 'METHOD_NOT_ALLOWED'
        | 'NOT_ACCEPTABLE'
        | 'PROXY_AUTHENTICATION_REQUIRED'
        | 'REQUEST_TIMEOUT'
        | 'CONFLICT'
        | 'GONE'
        | 'LENGTH_REQUIRED'
        | 'PRECONDITION_FAILED'
        | 'REQUEST_ENTITY_TOO_LARGE'
        | 'REQUEST_URI_TOO_LONG'
        | 'UNSUPPORTED_MEDIA_TYPE'
        | 'REQUESTED_RANGE_NOT_SATISFIABLE'
        | 'EXPECTATION_FAILED'
        | 'PRECONDITION_REQUIRED'
        | 'TOO_MANY_REQUESTS'
        | 'REQUEST_HEADER_FIELDS_TOO_LARGE'
        | 'UNAVAILABLE_FOR_LEGAL_REASONS'
        | 'INTERNAL_SERVER_ERROR'
        | 'NOT_IMPLEMENTED'
        | 'BAD_GATEWAY'
        | 'SERVICE_UNAVAILABLE'
        | 'GATEWAY_TIMEOUT'
        | 'HTTP_VERSION_NOT_SUPPORTED'
        | 'NETWORK_AUTHENTICATION_REQUIRED';
      message?: string;
      body: components['schemas']['AssistantConversationResponse'];
    };
    AssistantConversationResponse: {
      id: string;
      noteId: string;
      ownerId: string;
      title?: string;
      createdAt: string;
      updatedAt?: string;
      canSendMessage: boolean;
      messages: (
        | components['schemas']['AssistantUserMessage']
        | components['schemas']['AssistantAnswerMessage']
        | components['schemas']['AssistantToolMessage']
      )[];
    };
    AssistantMessage: {
      id: string;
      createdAt?: string;
    };
    AssistantConversationListResponse: {
      /** @enum {string} */
      status:
        | 'OK'
        | 'CREATED'
        | 'ACCEPTED'
        | 'NO_CONTENT'
        | 'RESET_CONTENT'
        | 'PARTIAL_CONTENT'
        | 'MULTIPLE_CHOICES'
        | 'MOVED_PERMANENTLY'
        | 'FOUND'
        | 'SEE_OTHER'
        | 'NOT_MODIFIED'
        | 'USE_PROXY'
        | 'TEMPORARY_REDIRECT'
        | 'PERMANENT_REDIRECT'
        | 'BAD_REQUEST'
        | 'UNAUTHORIZED'
        | 'PAYMENT_REQUIRED'
        | 'FORBIDDEN'
        | 'NOT_FOUND'
        | 'METHOD_NOT_ALLOWED'
        | 'NOT_ACCEPTABLE'
        | 'PROXY_AUTHENTICATION_REQUIRED'
        | 'REQUEST_TIMEOUT'
        | 'CONFLICT'
        | 'GONE'
        | 'LENGTH_REQUIRED'
        | 'PRECONDITION_FAILED'
        | 'REQUEST_ENTITY_TOO_LARGE'
        | 'REQUEST_URI_TOO_LONG'
        | 'UNSUPPORTED_MEDIA_TYPE'
        | 'REQUESTED_RANGE_NOT_SATISFIABLE'
        | 'EXPECTATION_FAILED'
        | 'PRECONDITION_REQUIRED'
        | 'TOO_MANY_REQUESTS'
        | 'REQUEST_HEADER_FIELDS_TOO_LARGE'
        | 'UNAVAILABLE_FOR_LEGAL_REASONS'
        | 'INTERNAL_SERVER_ERROR'
        | 'NOT_IMPLEMENTED'
        | 'BAD_GATEWAY'
        | 'SERVICE_UNAVAILABLE'
        | 'GATEWAY_TIMEOUT'
        | 'HTTP_VERSION_NOT_SUPPORTED'
        | 'NETWORK_AUTHENTICATION_REQUIRED';
      message?: string;
      body: components['schemas']['AssistantConversationMetadata'][];
    };
    AssistantRenameConversationRequest: {
      /** @description Must not be blank (String.isBlank) */
      title: string;
    };
    AssistantMessageListResponse: {
      /** @enum {string} */
      status:
        | 'OK'
        | 'CREATED'
        | 'ACCEPTED'
        | 'NO_CONTENT'
        | 'RESET_CONTENT'
        | 'PARTIAL_CONTENT'
        | 'MULTIPLE_CHOICES'
        | 'MOVED_PERMANENTLY'
        | 'FOUND'
        | 'SEE_OTHER'
        | 'NOT_MODIFIED'
        | 'USE_PROXY'
        | 'TEMPORARY_REDIRECT'
        | 'PERMANENT_REDIRECT'
        | 'BAD_REQUEST'
        | 'UNAUTHORIZED'
        | 'PAYMENT_REQUIRED'
        | 'FORBIDDEN'
        | 'NOT_FOUND'
        | 'METHOD_NOT_ALLOWED'
        | 'NOT_ACCEPTABLE'
        | 'PROXY_AUTHENTICATION_REQUIRED'
        | 'REQUEST_TIMEOUT'
        | 'CONFLICT'
        | 'GONE'
        | 'LENGTH_REQUIRED'
        | 'PRECONDITION_FAILED'
        | 'REQUEST_ENTITY_TOO_LARGE'
        | 'REQUEST_URI_TOO_LONG'
        | 'UNSUPPORTED_MEDIA_TYPE'
        | 'REQUESTED_RANGE_NOT_SATISFIABLE'
        | 'EXPECTATION_FAILED'
        | 'PRECONDITION_REQUIRED'
        | 'TOO_MANY_REQUESTS'
        | 'REQUEST_HEADER_FIELDS_TOO_LARGE'
        | 'UNAVAILABLE_FOR_LEGAL_REASONS'
        | 'INTERNAL_SERVER_ERROR'
        | 'NOT_IMPLEMENTED'
        | 'BAD_GATEWAY'
        | 'SERVICE_UNAVAILABLE'
        | 'GATEWAY_TIMEOUT'
        | 'HTTP_VERSION_NOT_SUPPORTED'
        | 'NETWORK_AUTHENTICATION_REQUIRED';
      message?: string;
      body: components['schemas']['AssistantMessagesResponse'];
    };
    AssistantMessagesResponse: {
      messages: (
        | components['schemas']['AssistantUserMessage']
        | components['schemas']['AssistantAnswerMessage']
        | components['schemas']['AssistantToolMessage']
      )[];
      cursor?: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  listAssistantConversations: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        noteId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AssistantConversationListResponse'];
        };
      };
    };
  };
  createAssistantConversation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        noteId: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': components['schemas']['AssistantConversationRequest'];
      };
    };
    responses: {
      /** @description Success */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AssistantConversationMetadataResponse'];
        };
      };
    };
  };
  getAssistantConversation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        noteId: string;
        conversationId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AssistantConversationDetailResponse'];
        };
      };
    };
  };
  deleteAssistantConversation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        noteId: string;
        conversationId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  renameAssistantConversation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        noteId: string;
        conversationId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AssistantRenameConversationRequest'];
      };
    };
    responses: {
      /** @description Success */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AssistantConversationMetadataResponse'];
        };
      };
    };
  };
  listAssistantMessages: {
    parameters: {
      query?: {
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        noteId: string;
        conversationId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Messages, latest first */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AssistantMessageListResponse'];
        };
      };
    };
  };
}
