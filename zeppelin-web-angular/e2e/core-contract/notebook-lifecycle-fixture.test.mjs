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
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createLifecycleStateReducer,
  createNotebookLifecycleRecorder,
  lifecycleFixtureVersion,
  replayLifecycleFixture,
  sanitizeLifecycleFixture,
  validateLifecycleContractCoverage,
  validateLifecycleFixture
} from './notebook-lifecycle-fixture.mjs';

const recordedSocket = page => {
  const socket = new EventEmitter();
  socket.url = () => 'ws://fixture.test/ws';
  page.emit('websocket', socket);
  return socket;
};

const operations = [
  'MOVE_PARAGRAPH',
  'INSERT_PARAGRAPH',
  'COPY_PARAGRAPH',
  'PARAGRAPH_REMOVE',
  'COMMIT_PARAGRAPH',
  'PARAGRAPH_ADDED',
  'PARAGRAPH_REMOVED',
  'PARAGRAPH_MOVED',
  'CHECKPOINT_NOTE',
  'LIST_REVISION_HISTORY',
  'NOTE_REVISION',
  'SET_NOTE_REVISION',
  'NOTE_REVISION_FOR_COMPARE',
  'PATCH_PARAGRAPH',
  'NOTE_UPDATED',
  'COLLABORATIVE_MODE_STATUS',
  'GET_NOTE',
  'RELOAD_NOTE',
  'GET_HOME_NOTE',
  'NEW_NOTE',
  'CLONE_NOTE',
  'NOTE',
  'LIST_NOTE_JOBS',
  'UNSUBSCRIBE_UPDATE_NOTE_JOBS'
];

const context = (activeNoteId, revisionId) => ({
  activeNoteId,
  ...(revisionId ? { revisionId } : {})
});

test('committed lifecycle artifact validates and replays', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/notebook-lifecycle.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('./fixtures/build-manifest.json', import.meta.url), 'utf8'));
  const expectedManifest = { ...manifest, id: manifest.manifestId };
  delete expectedManifest._license;
  delete expectedManifest.manifestId;
  assert.deepEqual(fixture.metadata.provenance.buildManifest, expectedManifest);
  assert.deepEqual(validateLifecycleFixture(fixture), []);
  assert.deepEqual(validateLifecycleContractCoverage(fixture), []);
  const reducer = createLifecycleStateReducer();
  let serverSnapshot;
  let convergenceNoteId;
  let recordsObserved = 0;
  const delivered = await replayLifecycleFixture(fixture, {
    onRecord: (record, deliveryState) => {
      recordsObserved += 1;
      reducer.apply(record, deliveryState);
      if (record.authoritativeInput !== 'full-note' || record.transport.websocket?.direction !== 'receive') return;
      const payload = JSON.parse(record.transport.websocket.payloadText);
      const note = payload.data?.note ?? payload.data;
      if (!note?.id || !Array.isArray(note.paragraphs)) return;
      const snapshot = {
        id: note.id,
        paragraphs: note.paragraphs.map(paragraph => ({
          id: paragraph.id,
          text: paragraph.text ?? '',
          title: paragraph.title ?? ''
        }))
      };
      serverSnapshot = snapshot;
      convergenceNoteId = note.id;
    },
    getActorSnapshot: actorId => reducer.getSnapshot(actorId, convergenceNoteId),
    getServerSnapshot: () => serverSnapshot
  });
  assert.equal(recordsObserved, delivered.length);
  assert.ok(fixture.convergence.actorIds.every(actorId => reducer.getSnapshot(actorId, convergenceNoteId)));
  assert.ok(serverSnapshot.paragraphs.some(paragraph => paragraph.text.includes('live')));
  assert.ok(
    delivered.some(entry => entry.duplicate),
    'fault replay did not duplicate a committed record'
  );
  assert.ok(
    delivered.some(entry => entry.delayed),
    'fault replay did not delay a committed record'
  );
  assert.ok(
    delivered.some(entry => entry.reordered),
    'fault replay did not reorder a committed record'
  );
});

test('suite validation rejects corrupted NOTE text that no longer applies the captured patch', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/notebook-lifecycle.json', import.meta.url), 'utf8'));
  for (const record of fixture.records) {
    if (record.authoritativeInput !== 'full-note' || record.transport.websocket?.direction !== 'receive') continue;
    const payload = JSON.parse(record.transport.websocket.payloadText);
    const note = payload.data?.note ?? payload.data;
    if (!Array.isArray(note?.paragraphs)) continue;
    for (const paragraph of note.paragraphs) paragraph.text = 'corrupted';
    record.transport.websocket.payloadText = JSON.stringify(payload);
  }
  assert.match(validateLifecycleContractCoverage(fixture).join('\n'), /PATCH_PARAGRAPH text/);
});

test('generic validation rejects an authoritative NOTE attributed to another active note', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/notebook-lifecycle.json', import.meta.url), 'utf8'));
  const record = fixture.records.find(candidate => {
    if (candidate.authoritativeInput !== 'full-note') return false;
    const payload = JSON.parse(candidate.transport.websocket.payloadText);
    return Boolean(payload.data?.note?.id);
  });
  record.captureContext.activeNoteId = 'another-note';
  assert.match(validateLifecycleFixture(fixture).join('\n'), /must match the authoritative NOTE payload/);
});

test('generic validation rejects an observed physical connection without a reconnect transition', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/notebook-lifecycle.json', import.meta.url), 'utf8'));
  fixture.metadata.captureSource = 'capture-server.sh';
  const source = fixture.records.find(record => record.connectionId === 'a-angular-2');
  assert.ok(source);
  fixture.records.push({
    ...structuredClone(source),
    connectionId: 'a-angular-3',
    sequence: fixture.records.at(-1).sequence + 1
  });
  assert.match(
    validateLifecycleFixture(fixture).join('\n'),
    /connection IDs must match one initial connection plus uniquely attributed reconnect transitions/
  );
});

test('structural event mutations fail causal validation and replay', async () => {
  const original = JSON.parse(await readFile(new URL('./fixtures/notebook-lifecycle.json', import.meta.url), 'utf8'));
  const cases = [
    ['PARAGRAPH_ADDED text', 'PARAGRAPH_ADDED', data => (data.paragraph.text = 'wrong')],
    ['PARAGRAPH_ADDED title', 'PARAGRAPH_ADDED', data => (data.paragraph.title = 'wrong')],
    ['PARAGRAPH_ADDED index', 'PARAGRAPH_ADDED', data => (data.index += 20)],
    ['PATCH_PARAGRAPH id', 'PATCH_PARAGRAPH', data => (data.paragraphId = 'missing-paragraph')],
    ['PARAGRAPH_MOVED index', 'PARAGRAPH_MOVED', data => (data.index += 20)],
    ['PARAGRAPH_REMOVED id', 'PARAGRAPH_REMOVED', data => (data.id = 'missing-paragraph')]
  ];
  for (const [label, operation, mutate] of cases) {
    const fixture = structuredClone(original);
    for (const record of fixture.records) {
      if (record.authoritativeInput !== 'granular-event' || record.transport.websocket?.direction !== 'receive') {
        continue;
      }
      const payload = JSON.parse(record.transport.websocket.payloadText);
      if (payload.op !== operation) continue;
      mutate(payload.data);
      record.transport.websocket.payloadText = JSON.stringify(payload);
    }
    assert.match(
      validateLifecycleFixture(fixture).join('\n'),
      /must match command|must match the other broadcast/,
      label
    );
    await assert.rejects(replayLifecycleFixture(fixture), /must match command|must match the other broadcast/, label);
  }
});

export const lifecycleFixture = () => {
  const records = [];
  const ws = (
    actorId,
    connectionId,
    captureContext,
    direction,
    payload,
    authoritativeInput = 'reply',
    operationPath = 'websocket'
  ) => {
    const sequence = records.length + 1;
    records.push({
      actorId,
      authoritativeInput,
      captureContext,
      connectionId,
      ingress: 'websocket',
      operationPath,
      sequence,
      transport: {
        kind: 'websocket',
        sequence,
        websocket: { direction, payloadText: JSON.stringify(payload) }
      }
    });
    return sequence;
  };
  const rest = (actorId, connectionId, captureContext, direction, method, url, body) => {
    const sequence = records.length + 1;
    const request = { bodyRaw: '', headers: { accept: 'application/json' }, method, url };
    records.push({
      actorId,
      authoritativeInput: 'none',
      captureContext,
      connectionId,
      ingress: 'rest',
      operationPath: 'rest',
      sequence,
      transport: {
        kind: 'rest',
        sequence,
        rest:
          direction === 'request'
            ? { direction, request }
            : {
                bodyJson: body,
                direction,
                headers: { 'content-type': 'application/json' },
                request,
                status: 200
              }
      }
    });
    return sequence;
  };

  const a = context('note-a');
  const b = context('note-b');
  const revision = context('note-b', 'rev-1');
  const jobManager = { routeKind: 'job-manager' };
  const created = context('note-new');
  const cloned = context('note-clone');
  ws('viewer-a', 'a-1', a, 'send', { op: 'GET_NOTE', data: { id: 'note-a' }, msgId: '<msgId:1>' });
  ws('viewer-a', 'a-1', a, 'receive', { op: 'NOTE', data: { id: 'note-a', paragraphs: [] }, msgId: '<msgId:1>' });
  ws(
    'viewer-a',
    'a-1',
    b,
    'receive',
    { op: 'PARAGRAPH_ADDED', data: { paragraph: { id: 'p-b' }, index: 0 } },
    'granular-event'
  );
  ws('viewer-a', 'a-1', b, 'send', { op: 'GET_NOTE', data: { id: 'note-b' }, msgId: '<msgId:2>' });
  ws('viewer-a', 'a-1', b, 'receive', {
    op: 'NOTE',
    data: { id: 'note-b', paragraphs: [{ id: 'p-b' }] },
    msgId: '<msgId:2>'
  });
  ws('viewer-a', 'a-1', b, 'receive', { op: 'PARAGRAPH_REMOVED', data: { id: 'p-old' } }, 'granular-event');
  ws('viewer-a', 'a-1', b, 'receive', { op: 'PARAGRAPH_MOVED', data: { id: 'p-b', index: 1 } }, 'granular-event');
  ws('viewer-a', 'a-1', b, 'receive', { op: 'NOTE_UPDATED', data: { name: 'note-b', config: {} } }, 'granular-event');
  ws('viewer-a', 'a-1', revision, 'send', { op: 'NOTE_REVISION', data: { noteId: 'note-b', revisionId: 'rev-1' } });
  ws('viewer-a', 'a-1', revision, 'receive', { op: 'NOTE_REVISION', data: { id: 'note-b', paragraphs: [] } });
  ws('viewer-a', 'a-1', revision, 'send', { op: 'LIST_REVISION_HISTORY', data: { noteId: 'note-b' } });
  ws('viewer-a', 'a-1', revision, 'receive', { op: 'LIST_REVISION_HISTORY', data: [{ id: 'rev-1' }] });
  // This live broadcast is intentionally untagged. Its route association is capture context, not wire identity.
  ws(
    'viewer-a',
    'a-1',
    revision,
    'receive',
    { op: 'NOTE_UPDATED', data: { name: 'live-note-b', config: {} } },
    'granular-event'
  );
  ws('viewer-a', 'a-1', revision, 'send', {
    op: 'NOTE_REVISION_FOR_COMPARE',
    data: { noteId: 'note-b', revisionId: 'rev-1', position: 'left' }
  });
  ws('viewer-a', 'a-1', revision, 'receive', {
    op: 'NOTE_REVISION_FOR_COMPARE',
    data: { id: 'note-b', paragraphs: [] }
  });
  ws('viewer-a', 'a-1', revision, 'send', { op: 'SET_NOTE_REVISION', data: { noteId: 'note-b', revisionId: 'rev-1' } });
  ws('viewer-a', 'a-1', revision, 'receive', { op: 'SET_NOTE_REVISION', data: { status: true } });
  ws('viewer-a', 'a-1', revision, 'send', {
    op: 'CHECKPOINT_NOTE',
    data: { noteId: 'note-b', commitMessage: 'checkpoint' }
  });
  ws('viewer-a', 'a-1', revision, 'receive', { op: 'CHECKPOINT_NOTE', data: { status: true } });
  const viewerAInitialDisconnectSequence = records.length;

  ws('viewer-b', 'b-1', a, 'send', { op: 'GET_NOTE', data: { id: 'note-a' } });
  const viewerBNoteLoaded = ws('viewer-b', 'b-1', a, 'receive', {
    op: 'NOTE',
    data: { id: 'note-a', paragraphs: [] }
  });
  ws('viewer-b', 'b-1', jobManager, 'send', { op: 'LIST_NOTE_JOBS' });
  ws('viewer-b', 'b-1', jobManager, 'receive', {
    op: 'LIST_NOTE_JOBS',
    data: { noteJobs: { jobs: [], lastResponseUnixTime: '<time>' } }
  });
  const jobManagerExitSequence = ws('viewer-b', 'b-1', jobManager, 'send', {
    op: 'UNSUBSCRIBE_UPDATE_NOTE_JOBS'
  });
  ws('viewer-b', 'b-1', a, 'send', { op: 'RELOAD_NOTE', data: { id: 'note-a' } });
  const reloadSequence = ws('viewer-b', 'b-1', a, 'receive', { op: 'NOTE', data: { id: 'note-a', paragraphs: [] } });
  ws('viewer-b', 'b-1', a, 'send', { op: 'GET_HOME_NOTE' });
  const homeSequence = ws('viewer-b', 'b-1', a, 'receive', { op: 'NOTE', data: { id: 'note-a', paragraphs: [] } });
  ws('viewer-b', 'b-1', a, 'send', { op: 'NEW_NOTE', data: { name: 'new-note' } });
  const newNoteSequence = ws('viewer-b', 'b-1', a, 'receive', { op: 'NEW_NOTE', data: { note: { id: 'note-new' } } });
  ws('viewer-b', 'b-1', created, 'send', { op: 'GET_NOTE', data: { id: 'note-new' } });
  ws('viewer-b', 'b-1', created, 'receive', { op: 'NOTE', data: { id: 'note-new', paragraphs: [] } });
  ws('viewer-b', 'b-1', created, 'send', { op: 'CLONE_NOTE', data: { id: 'note-a', name: 'clone' } });
  const cloneNoteSequence = ws('viewer-b', 'b-1', created, 'receive', {
    op: 'NEW_NOTE',
    data: { note: { id: 'note-clone' } }
  });
  ws('viewer-b', 'b-1', cloned, 'send', { op: 'GET_NOTE', data: { id: 'note-clone' } });
  const cloneLoadedSequence = ws('viewer-b', 'b-1', cloned, 'receive', {
    op: 'NOTE',
    data: { id: 'note-clone', paragraphs: [] }
  });
  ws('viewer-b', 'b-1', a, 'send', { op: 'GET_NOTE', data: { id: 'note-a' } });
  ws('viewer-b', 'b-1', a, 'receive', { op: 'NOTE', data: { id: 'note-a', paragraphs: [] } });

  ws('viewer-a', 'a-2', a, 'send', { op: 'LIST_REVISION_HISTORY', data: { noteId: 'note-a' } });
  ws('viewer-a', 'a-2', a, 'receive', { op: 'LIST_REVISION_HISTORY', data: [] });
  ws('viewer-a', 'a-2', a, 'send', { op: 'MOVE_PARAGRAPH', data: { id: 'p-1', index: 1 } });
  const moveReceive = ws(
    'viewer-a',
    'a-2',
    a,
    'receive',
    { op: 'PARAGRAPH_MOVED', data: { id: 'p-1', index: 1 } },
    'granular-event'
  );
  ws('viewer-a', 'a-2', a, 'send', { op: 'INSERT_PARAGRAPH', data: { index: 1 } });
  const insertReceive = ws(
    'viewer-a',
    'a-2',
    a,
    'receive',
    { op: 'PARAGRAPH_ADDED', data: { paragraph: { id: 'p-2' }, index: 1 } },
    'granular-event'
  );
  ws('viewer-a', 'a-2', a, 'send', { op: 'COPY_PARAGRAPH', data: { index: 2, paragraph: 'copy' } });
  ws(
    'viewer-a',
    'a-2',
    a,
    'receive',
    { op: 'PARAGRAPH_ADDED', data: { paragraph: { id: 'p-3' }, index: 2 } },
    'granular-event'
  );
  ws('viewer-a', 'a-2', a, 'send', { op: 'PARAGRAPH_REMOVE', data: { id: 'p-3' } });
  ws('viewer-a', 'a-2', a, 'receive', { op: 'PARAGRAPH_REMOVED', data: { id: 'p-3' } }, 'granular-event');
  const commitSequence = ws('viewer-a', 'a-2', a, 'send', {
    op: 'COMMIT_PARAGRAPH',
    data: { id: 'p-1', noteId: 'note-a', paragraph: 'local draft' }
  });
  const reconciliationRequestSequence = ws('viewer-a', 'a-2', a, 'send', {
    op: 'GET_NOTE',
    data: { id: 'note-a' }
  });
  const reconciliationConfirmationSequence = ws(
    'viewer-a',
    'a-2',
    a,
    'receive',
    { op: 'NOTE', data: { id: 'note-a', paragraphs: [{ id: 'p-1', text: 'server text' }] } },
    'full-note'
  );
  ws('viewer-a', 'a-2', a, 'send', { op: 'PATCH_PARAGRAPH', data: { id: 'p-1', noteId: 'note-a', patch: '@@ patch' } });
  const patchReceive = ws(
    'viewer-b',
    'b-1',
    a,
    'receive',
    {
      op: 'PATCH_PARAGRAPH',
      data: { id: 'p-1', noteId: 'note-a', patch: '@@ patch' }
    },
    'granular-event'
  );
  const noteUpdated = ws(
    'viewer-a',
    'a-2',
    a,
    'receive',
    {
      op: 'NOTE_UPDATED',
      data: { name: 'note-a', config: { looknfeel: 'simple' } }
    },
    'granular-event'
  );
  const modeStatus = ws(
    'viewer-b',
    'b-1',
    a,
    'receive',
    {
      op: 'COLLABORATIVE_MODE_STATUS',
      data: { status: true, users: ['<users>', '<users>'] }
    },
    'granular-event'
  );
  ws(
    'viewer-a',
    'a-2',
    a,
    'receive',
    {
      op: 'COLLABORATIVE_MODE_STATUS',
      data: { status: true, users: ['<users>', '<users>'] }
    },
    'granular-event'
  );
  ws('viewer-b', 'b-1', a, 'send', { op: 'GET_NOTE', data: { id: 'note-a' } });
  ws('viewer-b', 'b-1', a, 'receive', {
    op: 'NOTE',
    data: { id: 'note-a', paragraphs: [{ id: 'p-1', text: 'server text' }] }
  });

  const disconnectSequence = records.length;
  ws('viewer-a', 'a-3', a, 'send', { op: 'GET_NOTE', data: { id: 'note-a' } });
  const viewerAReconcileSequence = ws(
    'viewer-a',
    'a-3',
    a,
    'receive',
    { op: 'NOTE', data: { id: 'note-a', paragraphs: [{ id: 'p-1', text: 'server text' }] } },
    'full-note'
  );
  ws('viewer-a', 'a-3', a, 'send', { op: 'LIST_REVISION_HISTORY', data: { noteId: 'note-a' } });
  ws('viewer-a', 'a-3', a, 'receive', { op: 'LIST_REVISION_HISTORY', data: [] });
  ws('viewer-b', 'b-2', revision, 'send', { op: 'NOTE_REVISION', data: { noteId: 'note-b', revisionId: 'rev-1' } });
  ws('viewer-b', 'b-2', revision, 'receive', { op: 'NOTE_REVISION', data: { id: 'note-b', paragraphs: [] } });
  ws('viewer-b', 'b-2', revision, 'send', { op: 'LIST_REVISION_HISTORY', data: { noteId: 'note-b' } });
  ws('viewer-b', 'b-2', revision, 'receive', { op: 'LIST_REVISION_HISTORY', data: [{ id: 'rev-1' }] });

  const restStart = rest('viewer-b', 'b-3', a, 'request', 'POST', '/api/notebook/note-a/paragraph', undefined);
  rest('viewer-b', 'b-3', a, 'response', 'POST', '/api/notebook/note-a/paragraph', { body: 'p-rest' });
  ws(
    'viewer-b',
    'b-3',
    a,
    'receive',
    { op: 'NOTE', data: { id: 'note-a', paragraphs: [{ id: 'p-rest' }] } },
    'full-note',
    'rest'
  );
  rest('viewer-b', 'b-3', a, 'request', 'POST', '/api/notebook/note-a/paragraph/p-rest/move/0', undefined);
  rest('viewer-b', 'b-3', a, 'response', 'POST', '/api/notebook/note-a/paragraph/p-rest/move/0', { status: 'OK' });
  ws(
    'viewer-b',
    'b-3',
    a,
    'receive',
    { op: 'NOTE', data: { id: 'note-a', paragraphs: [{ id: 'p-rest' }] } },
    'full-note',
    'rest'
  );
  rest('viewer-b', 'b-3', a, 'request', 'DELETE', '/api/notebook/note-a/paragraph/p-rest', undefined);
  rest('viewer-b', 'b-3', a, 'response', 'DELETE', '/api/notebook/note-a/paragraph/p-rest', { status: 'OK' });
  ws('viewer-b', 'b-3', a, 'receive', { op: 'NOTE', data: { id: 'note-a', paragraphs: [] } }, 'full-note', 'rest');

  return {
    actors: [
      { authentication: 'authenticated', contextId: 'browser-context-a', id: 'viewer-a', principalAlias: 'user-a' },
      { authentication: 'authenticated', contextId: 'browser-context-b', id: 'viewer-b', principalAlias: 'user-b' }
    ],
    convergence: { actorIds: ['viewer-a', 'viewer-b'] },
    faults: [
      { kind: 'drop', sequence: commitSequence },
      { kind: 'duplicate', sequence: patchReceive },
      { afterSequence: viewerAReconcileSequence, kind: 'delay', sequence: moveReceive },
      { afterSequence: viewerAReconcileSequence, kind: 'reorder', sequence: insertReceive }
    ],
    metadata: {
      contract: 'ZEPPELIN-6672',
      coveredOperations: operations,
      owner: 'zeppelin-web-angular',
      protocolGaps: ['COMMIT_PARAGRAPH has no wire acknowledgement'],
      scenario: 'Structural, revision, collaboration, association and reconnect transport lifecycle'
    },
    records,
    transitions: [
      { actorId: 'viewer-a', afterSequence: 2, connectionId: 'a-1', kind: 'route', to: b },
      { actorId: 'viewer-a', afterSequence: 8, connectionId: 'a-1', kind: 'route', to: revision },
      {
        actorId: 'viewer-a',
        afterSequence: viewerAInitialDisconnectSequence,
        connectionId: 'a-1',
        kind: 'disconnect'
      },
      {
        actorId: 'viewer-a',
        afterSequence: viewerAInitialDisconnectSequence,
        connectionId: 'a-2',
        kind: 'reconnect'
      },
      { actorId: 'viewer-b', afterSequence: viewerBNoteLoaded, connectionId: 'b-1', kind: 'route', to: jobManager },
      { actorId: 'viewer-b', afterSequence: jobManagerExitSequence, connectionId: 'b-1', kind: 'route', to: a },
      { actorId: 'viewer-b', afterSequence: reloadSequence, connectionId: 'b-1', kind: 'route', to: a },
      { actorId: 'viewer-b', afterSequence: homeSequence, connectionId: 'b-1', kind: 'route', to: a },
      { actorId: 'viewer-b', afterSequence: newNoteSequence, connectionId: 'b-1', kind: 'route', to: created },
      { actorId: 'viewer-b', afterSequence: cloneNoteSequence, connectionId: 'b-1', kind: 'route', to: cloned },
      { actorId: 'viewer-b', afterSequence: cloneLoadedSequence, connectionId: 'b-1', kind: 'route', to: a },
      {
        actorId: 'viewer-a',
        afterSequence: commitSequence,
        connectionId: 'a-2',
        elapsedMs: 750,
        kind: 'timeout',
        observation: 'bounded-wait',
        reason: 'commit',
        triggerSequence: commitSequence
      },
      {
        actorId: 'viewer-a',
        afterSequence: reconciliationRequestSequence,
        confirmationSequence: reconciliationConfirmationSequence,
        connectionId: 'a-2',
        kind: 'reconcile',
        reason: 'commit',
        requestSequence: reconciliationRequestSequence,
        triggerSequence: commitSequence
      },
      { actorId: 'viewer-a', afterSequence: disconnectSequence, connectionId: 'a-2', kind: 'disconnect' },
      { actorId: 'viewer-a', afterSequence: disconnectSequence, connectionId: 'a-3', kind: 'reconnect' },
      { actorId: 'viewer-b', afterSequence: disconnectSequence, connectionId: 'b-1', kind: 'disconnect' },
      { actorId: 'viewer-b', afterSequence: disconnectSequence, connectionId: 'b-2', kind: 'reconnect' }
    ],
    version: lifecycleFixtureVersion
  };
};

test('lifecycle recorder composes real recorder events without changing their wire payloads', async () => {
  const pageA = new EventEmitter();
  const pageB = new EventEmitter();
  const contextA = context('note-a');
  let contextB = context('note-a');
  const recorder = createNotebookLifecycleRecorder(
    {
      coveredOperations: ['GET_NOTE', 'NOTE_UPDATED'],
      owner: 'zeppelin-web-angular',
      protocolGaps: [],
      scenario: 'Lifecycle recorder composition'
    },
    [
      { authentication: 'authenticated', contextId: 'context-a', id: 'viewer-a', principalAlias: 'user-a' },
      { authentication: 'authenticated', contextId: 'context-b', id: 'viewer-b', principalAlias: 'user-b' }
    ]
  );
  recorder.install({
    actorId: 'viewer-a',
    connectionId: 'a-1',
    getCaptureContext: () => contextA,
    page: pageA
  });
  recorder.install({
    actorId: 'viewer-b',
    connectionId: 'b-1',
    getCaptureContext: () => contextB,
    page: pageB
  });

  const socketA = recordedSocket(pageA);
  const socketB = recordedSocket(pageB);
  socketA.emit('framesent', { payload: '{"op":"GET_NOTE","data":{"id":"note-a"}}' });
  socketB.emit('framereceived', { payload: '{"op":"NOTE_UPDATED","data":{"name":"A"}}' });
  recorder.transition({ actorId: 'viewer-b', connectionId: 'b-1', kind: 'route', to: context('note-b') });
  contextB = context('note-b');
  socketB.emit('framesent', { payload: '{"op":"GET_NOTE","data":{"id":"note-b"}}' });
  await recorder.stop();

  const fixture = recorder.snapshot();
  assert.deepEqual(validateLifecycleFixture(fixture), []);
  assert.deepEqual(
    fixture.records.map(record => record.sequence),
    [1, 2, 3]
  );
  assert.equal(fixture.records[1].transport.websocket.payloadText, '{"op":"NOTE_UPDATED","data":{"name":"A"}}');
  assert.deepEqual(fixture.records[2].captureContext, context('note-b'));
});

test('ZEPPELIN-6672 fixture preserves path-specific inputs and untagged revision traffic', () => {
  const fixture = lifecycleFixture();
  assert.deepEqual(validateLifecycleFixture(fixture), []);
  assert.deepEqual(validateLifecycleContractCoverage(fixture), []);
  const restInputs = fixture.records.filter(
    record => record.operationPath === 'rest' && record.authoritativeInput === 'full-note'
  );
  const websocketInputs = fixture.records.filter(
    record => record.operationPath === 'websocket' && record.authoritativeInput === 'granular-event'
  );
  assert.equal(restInputs.length, 3);
  assert.ok(websocketInputs.length > 3);
  const revisionLiveUpdate = fixture.records.find(
    record =>
      record.captureContext.revisionId &&
      JSON.parse(record.transport.websocket?.payloadText ?? '{}').op === 'NOTE_UPDATED'
  );
  assert.equal(Object.hasOwn(JSON.parse(revisionLiveUpdate.transport.websocket.payloadText), 'noteId'), false);

  const unsanitized = lifecycleFixture();
  const envelope = JSON.parse(unsanitized.records[0].transport.websocket.payloadText);
  unsanitized.records[0].transport.websocket.payloadText = JSON.stringify({ ...envelope, principal: 'capture-user' });
  const sanitized = sanitizeLifecycleFixture(unsanitized);
  assert.equal(JSON.parse(sanitized.records[0].transport.websocket.payloadText).principal, '<principal>');
});

test('fault replay preserves local dirty state through timeout and converges after reconciliation', async () => {
  const fixture = lifecycleFixture();
  const snapshots = new Map([
    ['viewer-a', { paragraphs: [{ id: 'p-1', text: 'local draft' }], state: 'dirty' }],
    ['viewer-b', { paragraphs: [{ id: 'p-1', text: 'old' }], state: 'confirmed' }]
  ]);
  const server = { paragraphs: [{ id: 'p-1', text: 'server text' }], state: 'confirmed' };
  let timedOutWhileDirty = false;
  let reconciliationRequested = false;
  let reconciledByRefetch = false;
  const delivery = await replayLifecycleFixture(fixture, {
    getActorSnapshot: actorId => snapshots.get(actorId),
    getServerSnapshot: () => server,
    onRecord: record => {
      const payload = JSON.parse(record.transport.websocket?.payloadText ?? '{}');
      if (
        payload.op === 'NOTE' &&
        payload.data?.id === 'note-a' &&
        payload.data.paragraphs?.[0]?.text === 'server text'
      ) {
        snapshots.set(record.actorId, {
          paragraphs: payload.data.paragraphs,
          state: 'confirmed'
        });
        reconciledByRefetch ||= reconciliationRequested;
      }
    },
    onTransition: transition => {
      if (transition.kind === 'timeout' && transition.reason === 'commit') {
        timedOutWhileDirty = snapshots.get('viewer-a').state === 'dirty';
      }
      if (transition.kind === 'reconcile' && transition.reason === 'commit') reconciliationRequested = true;
    }
  });
  assert.equal(timedOutWhileDirty, true);
  assert.equal(reconciledByRefetch, true);
  assert.equal(
    delivery.some(entry => JSON.parse(entry.record.transport.websocket?.payloadText ?? '{}').op === 'COMMIT_PARAGRAPH'),
    false
  );
  assert.equal(
    delivery.some(entry => entry.duplicate),
    true
  );
  assert.equal(
    delivery.some(entry => entry.delayed),
    true
  );
  assert.equal(
    delivery.some(entry => entry.reordered),
    true
  );
});

test('runner rejects stale versions, ordering loss and invented association context', async () => {
  const stale = lifecycleFixture();
  stale.version += 1;
  assert.match(validateLifecycleFixture(stale).join('\n'), /Unsupported lifecycle fixture version/);
  await assert.rejects(() => replayLifecycleFixture(stale), /Unsupported lifecycle fixture version/);

  const reordered = lifecycleFixture();
  reordered.records[1].sequence = reordered.records[0].sequence;
  assert.match(validateLifecycleFixture(reordered).join('\n'), /sequence must increase without reordering/);

  const invented = lifecycleFixture();
  invented.records[1].captureContext = context('invented-note');
  assert.match(validateLifecycleFixture(invented).join('\n'), /changes capture context without a route transition/);

  const malformed = lifecycleFixture();
  malformed.transitions = {};
  assert.match(validateLifecycleFixture(malformed).join('\n'), /transitions must be an array/);

  const unfinishedRest = lifecycleFixture();
  unfinishedRest.records = unfinishedRest.records.filter(
    record =>
      !(record.transport.rest?.direction === 'response' && record.transport.rest.request.url.endsWith('/p-rest'))
  );
  assert.match(validateLifecycleFixture(unfinishedRest).join('\n'), /request has no response/);

  const multiplyFaulted = lifecycleFixture();
  multiplyFaulted.faults.push({ kind: 'duplicate', sequence: multiplyFaulted.faults[0].sequence });
  assert.match(validateLifecycleFixture(multiplyFaulted).join('\n'), /sequence may have only one fault/);
});

test('runner rejects committed timeout and reconciliation moved before the dropped commit', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/notebook-lifecycle.json', import.meta.url), 'utf8'));
  const commit = fixture.records.find(record => {
    const payload = JSON.parse(record.transport.websocket?.payloadText ?? '{}');
    return payload.op === 'COMMIT_PARAGRAPH';
  });
  assert.equal(commit.sequence, 25);
  const timeout = fixture.transitions.find(transition => transition.kind === 'timeout');
  const reconcile = fixture.transitions.find(transition => transition.kind === 'reconcile');
  timeout.afterSequence = 2;
  reconcile.afterSequence = 1;
  fixture.transitions.sort((left, right) => left.afterSequence - right.afterSequence);
  assert.match(
    validateLifecycleContractCoverage(fixture).join('\n'),
    /must bind to the dropped COMMIT_PARAGRAPH sequence|timeout must precede reconciliation/
  );
  await assert.rejects(
    replayLifecycleFixture(fixture),
    /does not reference a dropped COMMIT_PARAGRAPH|must bind to the dropped COMMIT_PARAGRAPH sequence|must bind reconciliation to an observed GET_NOTE request/
  );
});

test('suite faults must exercise state-mutating records', () => {
  const fixture = lifecycleFixture();
  const ignored = fixture.records.find(record => {
    const payload = JSON.parse(record.transport.websocket?.payloadText ?? '{}');
    return payload.op === 'COLLABORATIVE_MODE_STATUS';
  });
  fixture.faults.find(fault => fault.kind === 'duplicate').sequence = ignored.sequence;
  assert.match(
    validateLifecycleContractCoverage(fixture).join('\n'),
    /duplicate fault must target a state-mutating granular event/
  );
});

test('convergence compares nested notebook state and fails when paragraph text differs', async () => {
  const fixture = lifecycleFixture();
  const server = { paragraphs: [{ id: 'p-1', text: 'server text' }], state: 'confirmed' };
  await assert.rejects(
    () =>
      replayLifecycleFixture(fixture, {
        getActorSnapshot: actorId =>
          actorId === 'viewer-a' ? server : { paragraphs: [{ id: 'p-1', text: 'different text' }], state: 'confirmed' },
        getServerSnapshot: () => server
      }),
    /viewer-b did not converge/
  );
});
