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

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  hostOwnedOperations,
  notebookPermissionOperations,
  sessionExpiryMatrix,
  unhandledSessionOperations
} from './auth-error-contract.mjs';
import { fixtureMetadata, request, response } from './fixture-doubles.mjs';
import { createNotebookTransportRecorder, validateFixture } from './notebook-transport-fixture.mjs';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const loadFixture = name => JSON.parse(readFileSync(join(fixtureDirectory, name), 'utf8'));

const capturedFixtureNames = [
  'anonymous-permissions.json',
  'authenticated-permissions.json',
  'rest-401.json',
  'rest-405.json',
  'websocket-auth-info.json',
  'websocket-error-info.json',
  ...sessionExpiryMatrix.map(entry => entry.fixture)
];

test('committed permission captures come from the isolated server and retain server response envelopes', () => {
  const anonymous = loadFixture('anonymous-permissions.json');
  const authenticated = loadFixture('authenticated-permissions.json');

  assert.deepEqual(validateFixture(anonymous), []);
  assert.deepEqual(validateFixture(authenticated), []);
  assert.equal(anonymous.metadata.captureMode, 'anonymous');
  assert.equal(authenticated.metadata.captureMode, 'authenticated');
  assert.equal(anonymous.metadata.captureSource, 'capture-server.sh');
  assert.equal(authenticated.metadata.captureSource, 'capture-server.sh');
  assert.equal(authenticated.metadata.authorizationBasis, 'server principal and associated roles');
  assert.deepEqual(anonymous.metadata.coveredOperations, notebookPermissionOperations);
  assert.deepEqual(authenticated.metadata.coveredOperations, notebookPermissionOperations);

  const anonymousResponse = anonymous.records.find(record => record.rest?.direction === 'response');
  const authenticatedResponses = authenticated.records.filter(record => record.rest?.direction === 'response');
  assert.deepEqual(anonymousResponse.rest.bodyJson.body, {
    owners: [],
    readers: [],
    runners: [],
    writers: []
  });
  assert.deepEqual(authenticatedResponses[0].rest.bodyJson.body, {
    owners: ['<owners>'],
    readers: [],
    runners: [],
    writers: []
  });
  assert.deepEqual(authenticatedResponses[1].rest.bodyJson, { status: 'OK' });
});

test('captured REST and WebSocket outcomes stay outside notebook core ownership', () => {
  const rest401 = loadFixture('rest-401.json');
  const rest405 = loadFixture('rest-405.json');
  const authInfo = loadFixture('websocket-auth-info.json');
  const errorInfo = loadFixture('websocket-error-info.json');
  const sessionLogout = loadFixture('session-server-restart.json');
  for (const fixture of [rest401, rest405, authInfo, errorInfo, sessionLogout]) {
    assert.deepEqual(validateFixture(fixture), []);
    assert.equal(fixture.metadata.captureSource, 'capture-server.sh');
  }

  assert.equal(rest401.records.find(record => record.rest?.direction === 'response').rest.status, 401);
  assert.deepEqual(
    rest405.records.filter(record => record.rest?.direction === 'response').map(record => record.rest.status),
    [405, 405]
  );
  const authFrame = JSON.parse(
    authInfo.records.find(record => record.websocket?.direction === 'receive').websocket.payloadText
  );
  const sessionFrame = JSON.parse(
    sessionLogout.records.find(record => record.websocket?.direction === 'receive').websocket.payloadText
  );
  const errorFrame = JSON.parse(
    errorInfo.records.find(record => record.websocket?.direction === 'receive').websocket.payloadText
  );
  assert.equal(authFrame.op, 'AUTH_INFO');
  assert.equal(errorFrame.op, 'ERROR_INFO');
  assert.equal(sessionFrame.op, 'SESSION_LOGOUT');
  assert.equal(Object.hasOwn(authFrame, 'msgId'), false);
  assert.match(authFrame.data.info, /Allowed users or roles: \[<redacted>\]/);
  assert.ok(hostOwnedOperations.includes('ERROR_INFO'));
  assert.ok(unhandledSessionOperations.includes(sessionFrame.op));
  assert.match(rest401.metadata.knownExclusions[0], /401 carrying Location.*redirecting authentication realm/);
  assert.match(rest405.metadata.knownExclusions[0], /missing-response-URL guard/);
  assert.deepEqual(authInfo.metadata.knownExclusions, []);
  assert.deepEqual(errorInfo.metadata.knownExclusions, []);
  assert.deepEqual(sessionLogout.metadata.knownExclusions, []);
  assert.equal(sessionLogout.metadata.capturePhase, 'after-server-restart');
});

test('committed live captures redact configured users, passwords, tickets, and cookies', () => {
  for (const name of capturedFixtureNames) {
    const fixture = loadFixture(name);
    assert.match(fixture.metadata.provenance.sourceCommit, /^[0-9a-f]{40}$/, name);
    assert.equal(fixture.metadata.provenance.browser.name, 'chromium', name);
    assert.match(fixture.metadata.provenance.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/, name);
    assert.deepEqual(Object.keys(fixture.metadata.provenance.isolation).sort(), [
      'logs',
      'notebook',
      'pid',
      'recovery',
      'root',
      'searchIndex'
    ]);
    const serialized = JSON.stringify(fixture);
    assert.doesNotMatch(serialized, /user[123]|password[234]|JSESSIONID|rememberMe/i, name);
    assert.doesNotMatch(serialized, /"ticket":"(?!<ticket>)/i, name);
  }
});

test('committed auth and error captures bind the canonical source and artifact manifest', () => {
  const canonical = loadFixture('build-manifest.json');
  const expected = { ...canonical, id: canonical.manifestId };
  delete expected._license;
  delete expected.manifestId;

  for (const name of capturedFixtureNames) {
    const fixture = loadFixture(name);
    assert.deepEqual(fixture.metadata.provenance.buildManifest, expected, name);
    for (const mutation of [
      manifest => (manifest.id = '0'.repeat(64)),
      manifest => (manifest.baseCommit = '0'.repeat(40)),
      manifest => (manifest.sourceTree.sha256 = '0'.repeat(64)),
      manifest => (manifest.artifacts[0].sha256 = '0'.repeat(64))
    ]) {
      const changed = structuredClone(fixture);
      mutation(changed.metadata.provenance.buildManifest);
      assert.match(validateFixture(changed).join('\n'), /verified artifacts/, `${name} accepted changed manifest`);
    }
  }
});

test('session-expiry matrix is backed by four isolated-server captures with distinct histories', () => {
  assert.deepEqual(
    sessionExpiryMatrix.map(entry => entry.scenario),
    [
      'http-only-expiry',
      'http-expiry-then-existing-ticket-command',
      'ticket-removed-then-command',
      'server-restart-then-old-ticket-command'
    ]
  );
  const observedTransport = sessionExpiryMatrix.map(entry => {
    const fixture = loadFixture(entry.fixture);
    assert.deepEqual(validateFixture(fixture), [], entry.fixture);
    assert.equal(fixture.metadata.captureSource, 'capture-server.sh', entry.fixture);
    assert.deepEqual(fixture.metadata.knownExclusions, [], entry.fixture);
    const events = fixture.records.flatMap(record => {
      if (record.rest?.direction === 'response') {
        if (record.rest.request.url === '/api/login/logout') return ['LOGOUT'];
        if (record.rest.request.method === 'POST' && record.rest.request.url === '/api/login') {
          return ['LOGIN_REPLACEMENT_TICKET'];
        }
        return [`REST_${record.rest.status}`];
      }
      if (record.websocket?.direction === 'send') return ['WEBSOCKET_COMMAND'];
      if (record.websocket?.direction === 'receive') return [JSON.parse(record.websocket.payloadText).op];
      return [];
    });
    if (
      events.includes('WEBSOCKET_COMMAND') &&
      !fixture.records.some(record => record.websocket?.direction === 'receive')
    ) {
      events.push('NO_WEBSOCKET_RESPONSE');
    }
    return events;
  });
  assert.deepEqual(observedTransport, [
    ['REST_405'],
    ['REST_405', 'WEBSOCKET_COMMAND', 'COLLABORATIVE_MODE_STATUS', 'NOTE'],
    ['LOGOUT', 'WEBSOCKET_COMMAND', 'NO_WEBSOCKET_RESPONSE'],
    ['LOGIN_REPLACEMENT_TICKET', 'WEBSOCKET_COMMAND', 'SESSION_LOGOUT']
  ]);
});

test('recorder retains and redacts the 401 Location needed by the host redirect contract', async () => {
  const page = new EventEmitter();
  const recorder = createNotebookTransportRecorder(fixtureMetadata());
  const sourceRequest = request('GET', 'http://127.0.0.1:8080/api/notebook/note-a');

  recorder.install(page);
  page.emit('request', sourceRequest);
  page.emit(
    'response',
    response(sourceRequest, 401, '{"status":"UNAUTHORIZED"}', {
      'content-type': 'application/json',
      location: '/#/login?ticket=secret-ticket',
      'set-cookie': 'JSESSIONID=secret-session'
    })
  );
  page.emit('requestfinished', sourceRequest);
  await recorder.stop();

  const captured = recorder.snapshot().records[1].rest;
  assert.deepEqual(captured.headers, {
    'content-type': 'application/json',
    location: '/#/login?ticket=<redacted>'
  });
});
