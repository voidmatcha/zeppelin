/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export const notebookPermissionOperations = Object.freeze([
  'GET /api/notebook/{noteId}/permissions',
  'PUT /api/notebook/{noteId}/permissions'
]);

export const hostOwnedOperations = Object.freeze(['REST_401', 'REST_405', 'AUTH_INFO', 'ERROR_INFO']);

export const unhandledSessionOperations = Object.freeze(['SESSION_LOGOUT']);

export const sessionExpiryMatrix = Object.freeze([
  Object.freeze({
    scenario: 'http-only-expiry',
    fixture: 'session-http-only-expiry.json',
    browserContract: 'The host starts one logout request'
  }),
  Object.freeze({
    scenario: 'http-expiry-then-existing-ticket-command',
    fixture: 'session-http-expiry-existing-ticket.json',
    browserContract: 'HTTP logout and the WebSocket response are independent observations'
  }),
  Object.freeze({
    scenario: 'ticket-removed-then-command',
    fixture: 'session-ticket-removed.json',
    browserContract: 'The server silently drops a command when no ticket entry exists'
  }),
  Object.freeze({
    scenario: 'server-restart-then-old-ticket-command',
    fixture: 'session-server-restart.json',
    browserContract: 'SESSION_LOGOUT is observable but currently has no New UI receive mapping or handler'
  })
]);
