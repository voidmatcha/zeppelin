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

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { diff_match_patch as DiffMatchPatch } from 'diff-match-patch';

import {
  createNotebookTransportRecorder,
  sanitizeFixture,
  validateCaptureProvenance,
  validateReplayFixture
} from './notebook-transport-fixture.mjs';

export const lifecycleFixtureVersion = 1;

const ingressKinds = new Set(['rest', 'websocket']);
const reducerInputs = new Set(['full-note', 'granular-event', 'reply', 'none']);
const transitionKinds = new Set(['route', 'disconnect', 'reconnect', 'timeout', 'reconcile']);
const faultKinds = new Set(['delay', 'drop', 'duplicate', 'reorder']);
const stateMutationOperations = new Set(['PARAGRAPH_ADDED', 'PARAGRAPH_REMOVED', 'PARAGRAPH_MOVED', 'PATCH_PARAGRAPH']);

export function createNotebookLifecycleRecorder(metadata, actors) {
  const metadataErrors = [];
  validateMetadata(metadataErrors, metadata);
  if (!Array.isArray(actors) || actors.length === 0) metadataErrors.push('actors must be a non-empty array');
  if (metadataErrors.length > 0) throw new Error(metadataErrors.join('\n'));

  const actorIds = new Set(actors.map(actor => actor.id));
  const segments = new Map();
  const records = [];
  const transitions = [];
  const faults = [];
  let convergence;
  let sequence = 0;

  const appendRecord = ({ actorId, captureContext, classify, connectionId, transport }) => {
    if (!actorIds.has(actorId)) throw new Error(`Unknown lifecycle actor ${actorId}`);
    if (!nonEmpty(connectionId)) throw new Error('connectionId must be a non-empty string');
    const contextErrors = [];
    validateContext(contextErrors, 'record', captureContext);
    if (contextErrors.length > 0) throw new Error(contextErrors.join('\n'));
    const classification = classify?.(transport, captureContext) ?? {};
    records.push({
      actorId,
      authoritativeInput: classification.authoritativeInput ?? 'none',
      captureContext: { ...captureContext },
      connectionId,
      ingress: transport.kind,
      operationPath: classification.operationPath ?? transport.kind,
      sequence: ++sequence,
      transport
    });
  };

  const snapshot = () =>
    sanitizeLifecycleFixture({
      actors,
      ...(convergence ? { convergence } : {}),
      faults: [...faults],
      metadata,
      records: [...records],
      transitions: [...transitions],
      version: lifecycleFixtureVersion
    });

  return {
    converge: actorIds => {
      convergence = { actorIds: [...actorIds] };
    },
    fault: fault => faults.push({ ...fault, sequence: fault.sequence ?? sequence }),
    install: ({ actorId, classify, connectionId, getCaptureContext, page }) => {
      if (!actorIds.has(actorId)) throw new Error(`Unknown lifecycle actor ${actorId}`);
      if (!nonEmpty(connectionId)) throw new Error('connectionId must be a non-empty string');
      const segmentKey = `${actorId}:${connectionId}`;
      if (segments.has(segmentKey)) throw new Error(`Lifecycle connection ${segmentKey} is already installed`);
      if (typeof getCaptureContext !== 'function') throw new Error('getCaptureContext must be a function');
      const recorder = createNotebookTransportRecorder(
        {
          coveredOperations: metadata.coveredOperations,
          knownExclusions: metadata.knownExclusions ?? [],
          owner: metadata.owner,
          scenario: metadata.scenario
        },
        {
          onRecord: transport =>
            appendRecord({ actorId, captureContext: getCaptureContext(), classify, connectionId, transport })
        }
      );
      recorder.install(page);
      segments.set(segmentKey, recorder);
      return recorder;
    },
    recordObserved: options => appendRecord(options),
    snapshot,
    stop: async () => Promise.all([...segments.values()].map(recorder => recorder.stop())),
    transition: transition => transitions.push({ ...transition, afterSequence: transition.afterSequence ?? sequence }),
    write: async fixturePath => {
      await Promise.all([...segments.values()].map(recorder => recorder.stop()));
      const fixture = snapshot();
      const errors = validateLifecycleFixture(fixture);
      if (errors.length > 0) throw new Error(errors.join('\n'));
      mkdirSync(path.dirname(fixturePath), { recursive: true });
      writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
      return fixture;
    }
  };
}

export function sanitizeLifecycleFixture(fixture) {
  const records = sanitizeFixture({
    records: fixture.records.map(record => record.transport),
    version: 1
  }).records;
  return {
    ...fixture,
    records: fixture.records.map((record, index) => ({ ...record, transport: records[index] }))
  };
}

export function validateLifecycleFixture(fixture) {
  const errors = [];
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    return ['fixture must be an object'];
  }
  if (fixture.version !== lifecycleFixtureVersion) {
    errors.push(`Unsupported lifecycle fixture version ${fixture.version}`);
  }
  validateMetadata(errors, fixture.metadata);

  const actors = Array.isArray(fixture.actors) ? fixture.actors : [];
  if (actors.length < 1) {
    errors.push('actors must be a non-empty array');
  }
  const actorIds = new Set();
  for (const [index, actor] of actors.entries()) {
    const prefix = `actors[${index}]`;
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!nonEmpty(actor.id)) errors.push(`${prefix}.id must be a non-empty string`);
    if (actorIds.has(actor.id)) errors.push(`${prefix}.id must be unique`);
    actorIds.add(actor.id);
    if (!nonEmpty(actor.contextId)) errors.push(`${prefix}.contextId must be a non-empty string`);
    if (!['anonymous', 'authenticated'].includes(actor.authentication)) {
      errors.push(`${prefix}.authentication must be anonymous or authenticated`);
    }
    if (actor.authentication === 'authenticated' && !nonEmpty(actor.principalAlias)) {
      errors.push(`${prefix}.principalAlias is required for authenticated actors`);
    }
  }
  const authenticatedAliases = actors
    .filter(actor => actor?.authentication === 'authenticated')
    .map(actor => actor.principalAlias);
  if (new Set(authenticatedAliases).size !== authenticatedAliases.length) {
    errors.push('authenticated actors must use distinct principalAlias values');
  }

  if (!Array.isArray(fixture.records) || fixture.records.length < 1) {
    errors.push('records must be a non-empty array');
    return errors;
  }
  const sequences = new Set();
  let previousSequence = 0;
  const connections = new Map();
  const connectionSequences = new Map();
  const transportByConnection = new Map();
  const transitionsList = Array.isArray(fixture.transitions) ? fixture.transitions : [];
  const faultsList = Array.isArray(fixture.faults) ? fixture.faults : [];
  if (fixture.transitions !== undefined && !Array.isArray(fixture.transitions)) {
    errors.push('transitions must be an array');
  }
  if (fixture.faults !== undefined && !Array.isArray(fixture.faults)) errors.push('faults must be an array');
  for (const [index, record] of fixture.records.entries()) {
    const prefix = `records[${index}]`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!Number.isInteger(record.sequence) || record.sequence <= previousSequence) {
      errors.push(`${prefix}.sequence must increase without reordering`);
    }
    previousSequence = record.sequence;
    sequences.add(record.sequence);
    if (!actorIds.has(record.actorId)) errors.push(`${prefix}.actorId must reference an actor`);
    if (!nonEmpty(record.connectionId)) errors.push(`${prefix}.connectionId must be a non-empty string`);
    if (!ingressKinds.has(record.ingress)) errors.push(`${prefix}.ingress must be rest or websocket`);
    if (!ingressKinds.has(record.operationPath)) errors.push(`${prefix}.operationPath must be rest or websocket`);
    if (!reducerInputs.has(record.authoritativeInput)) {
      errors.push(`${prefix}.authoritativeInput is invalid`);
    }
    validateContext(errors, prefix, record.captureContext);
    const noteSnapshot = parseFullNoteSnapshot(record);
    if (
      noteSnapshot?.id &&
      record.captureContext?.routeKind !== 'job-manager' &&
      noteSnapshot.id !== record.captureContext?.activeNoteId
    ) {
      errors.push(
        `${prefix}.captureContext.activeNoteId must match the authoritative ${parseOperation(record.transport)} payload`
      );
    }
    const transportErrors = validateReplayFixture({ version: 1, records: [record.transport] });
    for (const error of transportErrors.filter(error => !error.includes('request has no response'))) {
      errors.push(`${prefix}.transport: ${error.replace(/^records\[0\]\.?/, '')}`);
    }
    if (record.transport?.kind !== record.ingress) {
      errors.push(`${prefix}.ingress must match transport.kind`);
    }
    const connectionKey = `${record.actorId}:${record.connectionId}`;
    const connectionTransport = transportByConnection.get(connectionKey) ?? [];
    connectionTransport.push(record.transport);
    transportByConnection.set(connectionKey, connectionTransport);
    const priorContext = connections.get(connectionKey);
    const contextKey = contextIdentity(record.captureContext);
    const previousConnectionSequence = connectionSequences.get(connectionKey) ?? 0;
    const matchingRoute = transitionsList.find(
      transition =>
        transition.kind === 'route' &&
        transition.actorId === record.actorId &&
        (!transition.connectionId || transition.connectionId === record.connectionId) &&
        transition.afterSequence >= previousConnectionSequence &&
        transition.afterSequence < record.sequence &&
        contextIdentity(transition.to) === contextKey
    );
    if (priorContext && priorContext !== contextKey && !matchingRoute) {
      errors.push(`${prefix} changes capture context without a route transition`);
    }
    connections.set(connectionKey, contextKey);
    connectionSequences.set(connectionKey, record.sequence);
  }

  for (const [connectionKey, records] of transportByConnection) {
    for (const error of validateReplayFixture({ version: 1, records })) {
      if (error.includes('request has no response')) {
        errors.push(`${connectionKey} transport: ${error}`);
      }
    }
  }

  const observedConnectionActors = new Map();
  const physicalSocketRecords = fixture.records.filter(
    record => record?.ingress === 'websocket' && record.operationPath === 'websocket'
  );
  for (const record of physicalSocketRecords) {
    if (!actorIds.has(record?.actorId) || !nonEmpty(record?.connectionId)) continue;
    const priorActor = observedConnectionActors.get(record.connectionId);
    if (priorActor && priorActor !== record.actorId) {
      errors.push(`connectionId ${record.connectionId} must identify one physical actor socket`);
    } else {
      observedConnectionActors.set(record.connectionId, record.actorId);
    }
  }
  for (const actorId of actorIds) {
    const observed = [
      ...new Set(
        physicalSocketRecords
          .filter(record => record?.actorId === actorId && nonEmpty(record.connectionId))
          .map(record => record.connectionId)
      )
    ];
    if (observed.length < 1) continue;
    const reconnects = transitionsList
      .filter(
        transition =>
          transition?.kind === 'reconnect' && transition.actorId === actorId && nonEmpty(transition.connectionId)
      )
      .map(transition => transition.connectionId);
    const expectedReconnects = observed.slice(1);
    if (
      reconnects.length !== new Set(reconnects).size ||
      reconnects.length !== expectedReconnects.length ||
      reconnects.some(connectionId => !expectedReconnects.includes(connectionId))
    ) {
      errors.push(
        `actor ${actorId} connection IDs must match one initial connection plus uniquely attributed reconnect transitions`
      );
    }
  }

  if (fixture.metadata?.contract === 'ZEPPELIN-6672' && fixture.metadata?.captureSource === 'live-server') {
    validateStructuralCausality(errors, fixture.records);
    validateStructuralState(errors, fixture.records);
  }

  let previousAfter = 0;
  for (const [index, transition] of transitionsList.entries()) {
    const prefix = `transitions[${index}]`;
    if (!transitionKinds.has(transition?.kind)) errors.push(`${prefix}.kind is invalid`);
    if (!actorIds.has(transition?.actorId)) errors.push(`${prefix}.actorId must reference an actor`);
    if (!Number.isInteger(transition?.afterSequence) || transition.afterSequence < previousAfter) {
      errors.push(`${prefix}.afterSequence must preserve transition order`);
    }
    if (!sequences.has(transition?.afterSequence)) errors.push(`${prefix}.afterSequence must reference a record`);
    previousAfter = transition?.afterSequence ?? previousAfter;
    if (transition?.kind === 'route') {
      validateContext(errors, prefix, transition.to);
      const nextRecord = fixture.records.find(
        record =>
          record.sequence > transition.afterSequence &&
          record.actorId === transition.actorId &&
          (!transition.connectionId || record.connectionId === transition.connectionId)
      );
      if (!nextRecord || contextIdentity(nextRecord.captureContext) !== contextIdentity(transition.to)) {
        errors.push(`${prefix} must make its destination the next captured context`);
      }
    }
    if (transition?.kind === 'timeout' && transition.reason === 'commit') {
      if (
        transition.observation !== 'bounded-wait' ||
        !Number.isInteger(transition.elapsedMs) ||
        transition.elapsedMs < 500
      ) {
        errors.push(`${prefix} must record an observed bounded commit timeout`);
      }
    }
    if (transition?.kind === 'reconcile' && transition.reason === 'commit') {
      const request = fixture.records.find(record => record.sequence === transition.requestSequence);
      const confirmation = fixture.records.find(record => record.sequence === transition.confirmationSequence);
      if (
        request?.actorId !== transition.actorId ||
        request?.connectionId !== transition.connectionId ||
        parseOperation(request?.transport) !== 'GET_NOTE' ||
        request?.transport?.websocket?.direction !== 'send' ||
        transition.afterSequence !== transition.requestSequence
      ) {
        errors.push(`${prefix} must bind reconciliation to an observed GET_NOTE request`);
      }
      if (
        confirmation?.actorId !== transition.actorId ||
        confirmation?.connectionId !== transition.connectionId ||
        parseOperation(confirmation?.transport) !== 'NOTE' ||
        confirmation?.authoritativeInput !== 'full-note' ||
        confirmation?.sequence <= transition.requestSequence
      ) {
        errors.push(`${prefix} must bind reconciliation to a later authoritative NOTE`);
      }
    }
    if (['disconnect', 'reconnect'].includes(transition?.kind) && !nonEmpty(transition.connectionId)) {
      errors.push(`${prefix}.connectionId is required for ${transition.kind}`);
    }
    if (transition?.kind === 'disconnect' && nonEmpty(transition.connectionId)) {
      const laterRecord = fixture.records.find(
        record =>
          record.sequence > transition.afterSequence &&
          record.actorId === transition.actorId &&
          record.connectionId === transition.connectionId
      );
      if (laterRecord) errors.push(`${prefix} connection must stay closed after disconnect`);
    }
    if (transition?.kind === 'reconnect' && nonEmpty(transition.connectionId)) {
      const reusedRecord = fixture.records.find(
        record =>
          record.sequence <= transition.afterSequence &&
          record.actorId === transition.actorId &&
          record.connectionId === transition.connectionId
      );
      const firstRecord = fixture.records.find(
        record =>
          record.sequence > transition.afterSequence &&
          record.actorId === transition.actorId &&
          record.connectionId === transition.connectionId
      );
      if (reusedRecord || !firstRecord) errors.push(`${prefix} must introduce a new physical connection`);
    }
  }

  const faultedSequences = new Set();
  for (const [index, fault] of faultsList.entries()) {
    const prefix = `faults[${index}]`;
    if (!faultKinds.has(fault?.kind)) errors.push(`${prefix}.kind is invalid`);
    if (!sequences.has(fault?.sequence)) errors.push(`${prefix}.sequence must reference a record`);
    if (faultedSequences.has(fault?.sequence)) errors.push(`${prefix}.sequence may have only one fault`);
    faultedSequences.add(fault?.sequence);
    if (['delay', 'reorder'].includes(fault?.kind)) {
      if (!Number.isInteger(fault.afterSequence) || !sequences.has(fault.afterSequence)) {
        errors.push(`${prefix}.afterSequence must reference a record`);
      } else if (fault.afterSequence <= fault.sequence) {
        errors.push(`${prefix}.afterSequence must follow sequence`);
      }
    }
  }

  return errors;
}

export function validateLifecycleContractCoverage(fixture) {
  const errors = [];
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) return ['fixture must be an object'];
  validateRequiredContract(errors, fixture);
  return errors;
}

export async function replayLifecycleFixture(fixture, observer = {}) {
  const errors = validateLifecycleFixture(fixture);
  if (errors.length > 0) throw new Error(errors.join('\n'));

  const schedule = new Map(
    fixture.records.map(record => [record.sequence, [{ record, sourceSequence: record.sequence }]])
  );
  const removeScheduled = sequence => {
    for (const entries of schedule.values()) {
      const index = entries.findIndex(entry => entry.sourceSequence === sequence && !entry.duplicate);
      if (index !== -1) return entries.splice(index, 1)[0];
    }
    return undefined;
  };
  for (const fault of fixture.faults ?? []) {
    const entry = removeScheduled(fault.sequence);
    if (!entry) continue;
    if (fault.kind === 'drop') {
      continue;
    } else if (fault.kind === 'duplicate') {
      schedule.get(fault.sequence).push(entry, { ...entry, duplicate: true });
    } else if (fault.kind === 'delay') {
      schedule.get(fault.afterSequence).push({ ...entry, delayed: true });
    } else {
      schedule.get(fault.afterSequence).push({ ...entry, reordered: true });
    }
  }

  const transitions = new Map();
  for (const transition of fixture.transitions ?? []) {
    const list = transitions.get(transition.afterSequence) ?? [];
    list.push(transition);
    transitions.set(transition.afterSequence, list);
  }
  const lifecycleState = createLifecycleStateReducer({ applyGranular: false });
  const faultsBySequence = new Map((fixture.faults ?? []).map(fault => [fault.sequence, fault]));
  const delivery = [];
  for (const record of fixture.records) {
    const sourceFault = faultsBySequence.get(record.sequence);
    if (sourceFault?.kind === 'drop' && parseOperation(record.transport) === 'COMMIT_PARAGRAPH') {
      lifecycleState.apply(record, { dropped: true, sourceSequence: record.sequence });
    }
    for (const entry of schedule.get(record.sequence) ?? []) {
      delivery.push(entry);
      const deliveryState = {
        delayed: Boolean(entry.delayed),
        duplicate: Boolean(entry.duplicate),
        reordered: Boolean(entry.reordered),
        sourceSequence: entry.sourceSequence
      };
      lifecycleState.apply(entry.record, deliveryState);
      await observer.onRecord?.(entry.record, {
        ...deliveryState
      });
    }
    for (const transition of transitions.get(record.sequence) ?? []) {
      lifecycleState.transition(transition);
      await observer.onTransition?.(transition);
    }
  }
  lifecycleState.assertComplete();

  if (fixture.convergence) {
    const server = await observer.getServerSnapshot?.();
    if (server === undefined) throw new Error('convergence requires getServerSnapshot');
    for (const actorId of fixture.convergence.actorIds) {
      const snapshot = await observer.getActorSnapshot?.(actorId);
      if (snapshot === undefined) throw new Error(`convergence requires a snapshot for ${actorId}`);
      if (stableJson(snapshot) !== stableJson(server)) {
        throw new Error(`${actorId} did not converge with the server snapshot`);
      }
    }
  }
  return delivery;
}

export function createLifecycleStateReducer({ applyGranular = true } = {}) {
  const snapshots = new Map();
  const authoritativeSequences = new Map();
  const commitStates = new Map();
  const keyFor = record => `${record.actorId}:${record.captureContext?.activeNoteId ?? ''}`;
  const commitKeyFor = (actorId, triggerSequence) => `${actorId}:${triggerSequence}`;

  return {
    apply: (record, delivery = {}) => {
      const direction = record.transport?.websocket?.direction;
      const payload = parsePayload(record.transport);
      if (direction === 'send' && payload?.op === 'COMMIT_PARAGRAPH' && delivery.dropped) {
        const noteId = payload.data?.noteId ?? record.captureContext?.activeNoteId;
        const paragraphId = payload.data?.id;
        if (!nonEmpty(noteId) || !nonEmpty(paragraphId))
          throw new Error('dropped COMMIT_PARAGRAPH lacks note identity');
        commitStates.set(commitKeyFor(record.actorId, record.sequence), {
          actorId: record.actorId,
          connectionId: record.connectionId,
          noteId,
          paragraphId,
          phase: 'dirty',
          triggerSequence: record.sequence
        });
        return;
      }
      if (direction !== 'receive' && !(direction === 'send' && payload?.op === 'PATCH_PARAGRAPH')) return;
      const snapshotKey = keyFor(record);
      const sourceSequence = delivery.sourceSequence ?? record.sequence;
      if (delivery.duplicate) return;
      if (
        (delivery.delayed || delivery.reordered) &&
        sourceSequence <= (authoritativeSequences.get(snapshotKey) ?? 0)
      ) {
        return;
      }
      const fullNote = parseFullNoteSnapshot(record);
      if (fullNote) {
        snapshots.set(snapshotKey, structuredClone(fullNote));
        authoritativeSequences.set(snapshotKey, record.sequence);
        for (const state of commitStates.values()) {
          if (
            state.phase === 'reconciling' &&
            state.actorId === record.actorId &&
            state.noteId === fullNote.id &&
            record.sequence > state.triggerSequence &&
            fullNote.paragraphs.some(paragraph => paragraph.id === state.paragraphId)
          ) {
            state.phase = 'confirmed';
            state.confirmationSequence = record.sequence;
          }
        }
        return;
      }
      const snapshot = snapshots.get(snapshotKey);
      if (direction === 'receive' && payload?.op === 'PARAGRAPH' && snapshot) {
        const paragraph = normalizeParagraph(payload.data?.paragraph);
        const index = snapshot.paragraphs.findIndex(item => item.id === paragraph.id);
        if (index !== -1) snapshot.paragraphs[index] = paragraph;
        return;
      }
      if (!applyGranular) return;
      if (record.authoritativeInput !== 'granular-event') return;
      if (!snapshot) return;
      const data = payload?.data ?? {};
      if (payload?.op === 'PARAGRAPH_ADDED') {
        const index = data.index;
        const paragraph = data.paragraph;
        if (!Number.isInteger(index) || index < 0 || index > snapshot.paragraphs.length) {
          throw new Error(`PARAGRAPH_ADDED has invalid index ${index}`);
        }
        if (!nonEmpty(paragraph?.id) || snapshot.paragraphs.some(item => item.id === paragraph.id)) {
          throw new Error('PARAGRAPH_ADDED must introduce a unique paragraph id');
        }
        snapshot.paragraphs.splice(index, 0, normalizeParagraph(paragraph));
      } else if (payload?.op === 'PARAGRAPH_REMOVED') {
        const index = snapshot.paragraphs.findIndex(paragraph => paragraph.id === data.id);
        if (index === -1) throw new Error(`PARAGRAPH_REMOVED references unknown paragraph ${data.id}`);
        snapshot.paragraphs.splice(index, 1);
      } else if (payload?.op === 'PARAGRAPH_MOVED') {
        const source = snapshot.paragraphs.findIndex(paragraph => paragraph.id === data.id);
        if (source === -1) throw new Error(`PARAGRAPH_MOVED references unknown paragraph ${data.id}`);
        const [paragraph] = snapshot.paragraphs.splice(source, 1);
        if (!Number.isInteger(data.index) || data.index < 0 || data.index > snapshot.paragraphs.length) {
          throw new Error(`PARAGRAPH_MOVED has invalid index ${data.index}`);
        }
        snapshot.paragraphs.splice(data.index, 0, paragraph);
      } else if (payload?.op === 'PATCH_PARAGRAPH') {
        const paragraphId = data.paragraphId ?? data.id;
        const paragraph = snapshot.paragraphs.find(item => item.id === paragraphId);
        if (!paragraph) throw new Error(`PATCH_PARAGRAPH references unknown paragraph ${paragraphId}`);
        const patcher = new DiffMatchPatch();
        const [text, applied] = patcher.patch_apply(patcher.patch_fromText(data.patch), paragraph.text);
        if (!applied.every(Boolean)) throw new Error(`PATCH_PARAGRAPH could not be applied to ${paragraphId}`);
        paragraph.text = text;
      }
    },
    assertComplete: () => {
      for (const state of commitStates.values()) {
        if (state.phase !== 'confirmed') {
          throw new Error(
            `dropped COMMIT_PARAGRAPH ${state.triggerSequence} ended ${state.phase} without authoritative confirmation`
          );
        }
      }
    },
    getCommitState: (actorId, triggerSequence) => commitStates.get(commitKeyFor(actorId, triggerSequence)),
    getSnapshot: (actorId, noteId) => snapshots.get(`${actorId}:${noteId}`),
    transition: transition => {
      if (!['timeout', 'reconcile'].includes(transition.kind) || transition.reason !== 'commit') return;
      const state = commitStates.get(commitKeyFor(transition.actorId, transition.triggerSequence));
      if (!state) throw new Error(`${transition.kind} does not reference a dropped COMMIT_PARAGRAPH`);
      if (transition.afterSequence < state.triggerSequence) {
        throw new Error(`${transition.kind} precedes COMMIT_PARAGRAPH ${state.triggerSequence}`);
      }
      if (transition.kind === 'timeout' && transition.connectionId !== state.connectionId) {
        throw new Error(`${transition.kind} must use the COMMIT_PARAGRAPH connection`);
      }
      if (transition.kind === 'timeout') {
        if (state.phase !== 'dirty') throw new Error('commit timeout requires dirty state');
        state.phase = 'timed-out';
      } else {
        if (state.phase !== 'timed-out') throw new Error('commit reconciliation requires a preceding timeout');
        state.phase = 'reconciling';
      }
    }
  };
}

function validateMetadata(errors, metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push('metadata must be an object');
    return;
  }
  if (!nonEmpty(metadata.scenario)) errors.push('metadata.scenario must be a non-empty string');
  if (!nonEmpty(metadata.owner)) errors.push('metadata.owner must be a non-empty string');
  if (!Array.isArray(metadata.coveredOperations) || metadata.coveredOperations.some(op => !nonEmpty(op))) {
    errors.push('metadata.coveredOperations must be a string array');
  }
  if (!Array.isArray(metadata.protocolGaps) || metadata.protocolGaps.some(gap => !nonEmpty(gap))) {
    errors.push('metadata.protocolGaps must be a string array');
  }
  errors.push(...validateCaptureProvenance(metadata));
}

function validateContext(errors, prefix, context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    errors.push(`${prefix}.captureContext must be an object`);
    return;
  }
  const routeKind = context.routeKind ?? 'note';
  if (!['note', 'job-manager'].includes(routeKind)) {
    errors.push(`${prefix}.captureContext.routeKind must be note or job-manager`);
  }
  if (routeKind === 'note' && !nonEmpty(context.activeNoteId)) {
    errors.push(`${prefix}.captureContext.activeNoteId is required for note routes`);
  }
  if (routeKind === 'job-manager' && context.activeNoteId !== undefined) {
    errors.push(`${prefix}.captureContext.activeNoteId must be absent for the job manager route`);
  }
  if (routeKind === 'job-manager' && context.revisionId !== undefined) {
    errors.push(`${prefix}.captureContext.revisionId must be absent for the job manager route`);
  } else if (context.revisionId !== undefined && !nonEmpty(context.revisionId)) {
    errors.push(`${prefix}.captureContext.revisionId must be a non-empty string when present`);
  }
}

function validateRequiredContract(errors, fixture) {
  if (fixture.metadata?.contract !== 'ZEPPELIN-6672') return;
  const faults = Array.isArray(fixture.faults) ? fixture.faults : [];
  const transitions = Array.isArray(fixture.transitions) ? fixture.transitions : [];
  const required = new Set([
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
  ]);
  const covered = new Set(Array.isArray(fixture.metadata.coveredOperations) ? fixture.metadata.coveredOperations : []);
  for (const operation of required) {
    if (!covered.has(operation)) errors.push(`metadata.coveredOperations is missing ${operation}`);
  }
  const actors = Array.isArray(fixture.actors) ? fixture.actors : [];
  const contexts = new Set(actors.map(actor => actor.contextId));
  if (contexts.size < 2) errors.push('ZEPPELIN-6672 collaboration capture requires two independent contexts');
  const authenticated = actors.filter(actor => actor.authentication === 'authenticated');
  if (authenticated.length === 1) errors.push('authenticated collaboration capture requires two distinct users');

  const wsOperations = fixture.records.map(record => parseOperation(record.transport)).filter(Boolean);
  for (const operation of required) {
    if (!wsOperations.includes(operation)) errors.push(`records are missing ${operation}`);
  }
  const restStructural = fixture.records.filter(
    record => record.operationPath === 'rest' && record.authoritativeInput === 'full-note'
  );
  const wsStructural = fixture.records.filter(
    record => record.operationPath === 'websocket' && record.authoritativeInput === 'granular-event'
  );
  if (restStructural.length === 0) errors.push('REST structural capture must declare full-note authoritative input');
  if (wsStructural.length === 0)
    errors.push('WebSocket structural capture must declare granular-event authoritative input');
  const restPaths = [
    ['insert', 'POST', /^\/api\/notebook\/[^/]+\/paragraph$/],
    ['move', 'POST', /^\/api\/notebook\/[^/]+\/paragraph\/[^/]+\/move\/\d+$/],
    ['remove', 'DELETE', /^\/api\/notebook\/[^/]+\/paragraph\/[^/]+$/]
  ];
  for (const [name, method, path] of restPaths) {
    const requestIndex = fixture.records.findIndex(
      record =>
        record.transport?.kind === 'rest' &&
        record.transport.rest?.direction === 'request' &&
        record.transport.rest.request?.method === method &&
        path.test(record.transport.rest.request?.url ?? '')
    );
    if (requestIndex === -1) {
      errors.push(`REST structural capture is missing the ${name} request`);
      continue;
    }
    const requestRecord = fixture.records[requestIndex];
    const responseIndex = fixture.records.findIndex(
      (record, index) =>
        index > requestIndex &&
        record.actorId === requestRecord.actorId &&
        record.connectionId === requestRecord.connectionId &&
        record.transport?.kind === 'rest' &&
        record.transport.rest?.direction === 'response' &&
        record.transport.rest.request?.method === method &&
        record.transport.rest.request?.url === requestRecord.transport.rest.request.url
    );
    const nextRequestIndex = fixture.records.findIndex(
      (record, index) =>
        index > requestIndex &&
        record.actorId === requestRecord.actorId &&
        record.connectionId === requestRecord.connectionId &&
        record.transport?.kind === 'rest' &&
        record.transport.rest?.direction === 'request'
    );
    const fullNote = fixture.records.some(
      (record, index) =>
        index > requestIndex &&
        (nextRequestIndex === -1 || index < nextRequestIndex) &&
        record.actorId === requestRecord.actorId &&
        record.connectionId === requestRecord.connectionId &&
        record.operationPath === 'rest' &&
        record.authoritativeInput === 'full-note' &&
        parseOperation(record.transport) === 'NOTE'
    );
    if (responseIndex === -1 || !fullNote) {
      errors.push(`REST structural ${name} must retain its response and causally paired full NOTE input`);
    }
  }

  const jobManagerRecords = fixture.records.filter(record => record.captureContext?.routeKind === 'job-manager');
  const jobManagerOperations = new Set(
    jobManagerRecords.map(record => parseOperation(record.transport)).filter(Boolean)
  );
  if (!jobManagerOperations.has('LIST_NOTE_JOBS') || !jobManagerOperations.has('UNSUBSCRIBE_UPDATE_NOTE_JOBS')) {
    errors.push('job manager association capture must subscribe and unsubscribe on its own route context');
  }

  const commit = fixture.records.find(record => parseOperation(record.transport) === 'COMMIT_PARAGRAPH');
  const commitDropped = commit && faults.some(fault => fault.kind === 'drop' && fault.sequence === commit.sequence);
  const timeout = transitions.find(transition => transition.kind === 'timeout' && transition.reason === 'commit');
  const reconcile = transitions.find(transition => transition.kind === 'reconcile' && transition.reason === 'commit');
  if (!commitDropped || !timeout || !reconcile) errors.push('dropped COMMIT_PARAGRAPH must timeout and reconcile');
  if (commitDropped && timeout && reconcile) {
    if (
      timeout.triggerSequence !== commit.sequence ||
      reconcile.triggerSequence !== commit.sequence ||
      timeout.afterSequence !== commit.sequence ||
      reconcile.requestSequence <= commit.sequence
    ) {
      errors.push('commit timeout and reconciliation must bind to the dropped COMMIT_PARAGRAPH sequence');
    }
    if (
      timeout.actorId !== commit.actorId ||
      reconcile.actorId !== commit.actorId ||
      timeout.connectionId !== commit.connectionId
    ) {
      errors.push('commit timeout and reconciliation must bind to the COMMIT_PARAGRAPH actor and connection');
    }
    if (transitions.indexOf(timeout) > transitions.indexOf(reconcile)) {
      errors.push('commit timeout must precede reconciliation');
    }
    const commitPayload = parsePayload(commit.transport);
    const confirmation = fixture.records.find(record => {
      const snapshot = parseFullNoteSnapshot(record);
      return (
        record.sequence === reconcile.confirmationSequence &&
        record.actorId === commit.actorId &&
        snapshot?.id === (commitPayload?.data?.noteId ?? commit.captureContext?.activeNoteId) &&
        snapshot.paragraphs.some(paragraph => paragraph.id === commitPayload?.data?.id)
      );
    });
    if (!confirmation) errors.push('commit reconciliation must end in a later authoritative NOTE confirmation');
  }
  if (
    !Array.isArray(fixture.metadata.protocolGaps) ||
    !fixture.metadata.protocolGaps.includes('COMMIT_PARAGRAPH has no wire acknowledgement')
  ) {
    errors.push('dropped COMMIT_PARAGRAPH must record its acknowledgement protocol gap');
  }
  for (const kind of faultKinds) {
    if (!faults.some(fault => fault.kind === kind)) errors.push(`faults are missing ${kind}`);
  }
  for (const fault of faults.filter(item => item.kind !== 'drop')) {
    const record = fixture.records.find(candidate => candidate.sequence === fault.sequence);
    if (
      record?.transport?.websocket?.direction !== 'receive' ||
      record.authoritativeInput !== 'granular-event' ||
      !stateMutationOperations.has(parseOperation(record.transport))
    ) {
      errors.push(`${fault.kind} fault must target a state-mutating granular event`);
    }
    if (
      ['delay', 'reorder'].includes(fault.kind) &&
      !fixture.records.some(
        candidate =>
          candidate.sequence > fault.sequence &&
          candidate.sequence <= fault.afterSequence &&
          candidate.actorId === record?.actorId &&
          candidate.captureContext?.activeNoteId === record?.captureContext?.activeNoteId &&
          parseFullNoteSnapshot(candidate)
      )
    ) {
      errors.push(`${fault.kind} fault must cross an authoritative NOTE reconciliation`);
    }
  }
  if (!fixture.convergence || !Array.isArray(fixture.convergence.actorIds) || fixture.convergence.actorIds.length < 2) {
    errors.push('collaboration faults must declare two-viewer convergence');
  } else if (fixture.metadata?.captureSource === 'live-server') {
    const finalSnapshots = fixture.convergence.actorIds.map(actorId => {
      const record = [...fixture.records]
        .reverse()
        .find(candidate => candidate.actorId === actorId && parseFullNoteSnapshot(candidate));
      return { actorId, record, snapshot: record ? parseFullNoteSnapshot(record) : undefined };
    });
    for (const { actorId, snapshot } of finalSnapshots) {
      if (!snapshot) errors.push(`convergence actor ${actorId} must finish with an authoritative NOTE payload`);
    }
    const expected = finalSnapshots[0]?.snapshot;
    for (const { actorId, snapshot } of finalSnapshots.slice(1)) {
      if (expected && snapshot && stableJson(snapshot) !== stableJson(expected)) {
        errors.push(`convergence actor ${actorId} must finish with the same notebook state`);
      }
    }
  }
  const transitionKindsSeen = new Set(transitions.map(transition => transition.kind));
  for (const kind of ['route', 'disconnect', 'reconnect', 'timeout', 'reconcile']) {
    if (!transitionKindsSeen.has(kind)) errors.push(`transitions are missing ${kind}`);
  }

  const liveRoute = transitions.find(transition => transition.kind === 'route' && !transition.to?.revisionId);
  if (liveRoute) {
    const nextRoute = transitions.find(
      transition =>
        transition.kind === 'route' &&
        transition.actorId === liveRoute.actorId &&
        transition.afterSequence > liveRoute.afterSequence
    );
    const routeRecords = fixture.records.filter(
      record =>
        record.actorId === liveRoute.actorId &&
        record.sequence > liveRoute.afterSequence &&
        (!nextRoute || record.sequence <= nextRoute.afterSequence) &&
        contextIdentity(record.captureContext) === contextIdentity(liveRoute.to)
    );
    const noteIndex = routeRecords.findIndex(record => parseOperation(record.transport) === 'NOTE');
    const isGranular = record => record.authoritativeInput === 'granular-event';
    if (
      noteIndex < 1 ||
      !routeRecords.slice(0, noteIndex).some(isGranular) ||
      !routeRecords.slice(noteIndex + 1).some(isGranular)
    ) {
      errors.push('live route transition must preserve granular events before and after NOTE');
    }
  }

  const revisionRecords = fixture.records.filter(record => record.captureContext?.revisionId);
  if (
    !revisionRecords.some(record => parseOperation(record.transport) === 'NOTE_REVISION') ||
    !revisionRecords.some(record => parseOperation(record.transport) === 'NOTE_UPDATED')
  ) {
    errors.push('revision route must record NOTE_REVISION separately from later live events');
  }

  for (const transition of transitions.filter(item => item.kind === 'reconnect')) {
    const records = fixture.records.filter(
      record => record.actorId === transition.actorId && record.connectionId === transition.connectionId
    );
    const reconnectOperations = new Set(records.map(record => parseOperation(record.transport)).filter(Boolean));
    const revisionReconnect = records.some(record => record.captureContext?.revisionId);
    const expected = revisionReconnect ? 'NOTE_REVISION' : 'GET_NOTE';
    if (!reconnectOperations.has(expected) || !reconnectOperations.has('LIST_REVISION_HISTORY')) {
      errors.push(
        `reconnect ${transition.actorId}:${transition.connectionId} must send ${expected} and LIST_REVISION_HISTORY`
      );
    }
  }

  for (const patchRecord of fixture.records.filter(
    record =>
      record.transport?.websocket?.direction === 'send' && parseOperation(record.transport) === 'PATCH_PARAGRAPH'
  )) {
    const payload = parsePayload(patchRecord.transport);
    const noteId = payload?.data?.noteId ?? patchRecord.captureContext?.activeNoteId;
    const addedText = String(payload?.data?.patch ?? '')
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1))
      .join('\n');
    if (!addedText) continue;
    const reconciled = fixture.records.some(record => {
      if (record.sequence <= patchRecord.sequence || record.captureContext?.activeNoteId !== noteId) return false;
      const snapshot = parseFullNoteSnapshot(record);
      return snapshot?.paragraphs.some(paragraph => paragraph.text.includes(addedText));
    });
    if (!reconciled) errors.push('PATCH_PARAGRAPH text must appear in a later authoritative NOTE payload');
  }
}

function parseOperation(transport) {
  return parsePayload(transport)?.op;
}

function parsePayload(transport) {
  if (transport?.kind !== 'websocket' || typeof transport.websocket?.payloadText !== 'string') return undefined;
  try {
    return JSON.parse(transport.websocket.payloadText);
  } catch {
    return undefined;
  }
}

function parseFullNoteSnapshot(record) {
  if (record?.authoritativeInput !== 'full-note' || record.transport?.websocket?.direction !== 'receive') {
    return undefined;
  }
  const payload = parsePayload(record.transport);
  if (!['NOTE', 'NOTE_REVISION'].includes(payload?.op)) return undefined;
  const note = payload?.data?.note ?? payload?.data;
  if (!nonEmpty(note?.id) || !Array.isArray(note?.paragraphs)) return undefined;
  return {
    id: note.id,
    paragraphs: note.paragraphs.map(normalizeParagraph)
  };
}

function normalizeParagraph(paragraph) {
  return {
    id: paragraph?.id ?? '',
    text: paragraph?.text ?? '',
    title: paragraph?.title ?? ''
  };
}

function validateStructuralCausality(errors, records) {
  const responseFor = new Map([
    ['INSERT_PARAGRAPH', 'PARAGRAPH_ADDED'],
    ['COPY_PARAGRAPH', 'PARAGRAPH_ADDED'],
    ['MOVE_PARAGRAPH', 'PARAGRAPH_MOVED'],
    ['PARAGRAPH_REMOVE', 'PARAGRAPH_REMOVED'],
    ['PATCH_PARAGRAPH', 'PATCH_PARAGRAPH'],
    ['NOTE_UPDATE', 'NOTE_UPDATED']
  ]);
  const latest = new Map();
  const firstReply = new Map();
  for (const record of records) {
    const payload = parsePayload(record.transport);
    if (record.transport?.websocket?.direction === 'send' && responseFor.has(payload?.op)) {
      latest.set(responseFor.get(payload.op), { payload, sequence: record.sequence });
      continue;
    }
    if (record.transport?.websocket?.direction !== 'receive' || !latest.has(payload?.op)) continue;
    const command = latest.get(payload.op);
    const expected = command.payload.data ?? {};
    const actual = payload.data ?? {};
    const prefix = `record ${record.sequence} ${payload.op}`;
    if (payload.op === 'PARAGRAPH_ADDED') {
      if (actual.index !== expected.index) errors.push(`${prefix} index must match command ${command.sequence}`);
      if ((actual.paragraph?.text ?? '') !== '') {
        errors.push(`${prefix} text must match command ${command.sequence}`);
      }
      if ((actual.paragraph?.title ?? '') !== (expected.title ?? '')) {
        errors.push(`${prefix} title must match command ${command.sequence}`);
      }
      if (!nonEmpty(actual.paragraph?.id)) errors.push(`${prefix} must carry a paragraph id`);
    } else if (payload.op === 'PATCH_PARAGRAPH') {
      if ((actual.paragraphId ?? actual.id) !== expected.id || actual.patch !== expected.patch) {
        errors.push(`${prefix} must match command ${command.sequence}`);
      }
    } else if (payload.op === 'PARAGRAPH_MOVED') {
      if (actual.id !== expected.id || actual.index !== expected.index) {
        errors.push(`${prefix} must match command ${command.sequence}`);
      }
    } else if (payload.op === 'PARAGRAPH_REMOVED') {
      if (actual.id !== expected.id) errors.push(`${prefix} must match command ${command.sequence}`);
    } else if (payload.op === 'NOTE_UPDATED') {
      if (actual.name !== expected.name || stableJson(actual.config ?? {}) !== stableJson(expected.config ?? {})) {
        errors.push(`${prefix} must match command ${command.sequence}`);
      }
    }
    const canonical = stableJson(actual);
    const previous = firstReply.get(command.sequence);
    if (previous !== undefined && previous !== canonical) {
      errors.push(`${prefix} must match the other broadcast for command ${command.sequence}`);
    } else {
      firstReply.set(command.sequence, canonical);
    }
  }
}

function validateStructuralState(errors, records) {
  const reducer = createLifecycleStateReducer();
  const changed = new Set();
  const restBarriers = new Set();
  const structuralOperations = new Set(['PARAGRAPH_ADDED', 'PARAGRAPH_REMOVED', 'PARAGRAPH_MOVED', 'PATCH_PARAGRAPH']);
  for (const record of records) {
    if (record.transport?.kind === 'rest') {
      const method = record.transport.rest.request?.method;
      if (method && method !== 'GET') {
        const noteId = record.captureContext?.activeNoteId ?? '';
        if (record.transport.rest.direction === 'request') restBarriers.add(noteId);
        else restBarriers.delete(noteId);
      }
      continue;
    }
    const direction = record.transport?.websocket?.direction;
    if (direction !== 'receive' && direction !== 'send') continue;
    const noteId = record.captureContext?.activeNoteId;
    const key = `${record.actorId}:${noteId ?? ''}`;
    const payload = parsePayload(record.transport);
    const fullNote = parseFullNoteSnapshot(record);
    if (fullNote && changed.has(key) && !restBarriers.has(noteId ?? '')) {
      const derived = reducer.getSnapshot(record.actorId, noteId);
      if (derived && stableJson(derived) !== stableJson(fullNote)) {
        errors.push(`record ${record.sequence} full NOTE must match state derived from granular events`);
      }
      changed.delete(key);
    }
    if (fullNote && restBarriers.has(noteId ?? '')) changed.delete(key);
    try {
      reducer.apply(record);
      if (structuralOperations.has(payload?.op) && reducer.getSnapshot(record.actorId, noteId)) {
        changed.add(key);
      }
    } catch (error) {
      errors.push(`record ${record.sequence} cannot update lifecycle state: ${error.message}`);
    }
  }
}

const contextIdentity = context =>
  `${context?.routeKind ?? 'note'}:${context?.activeNoteId ?? ''}:${context?.revisionId ?? ''}`;
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const stableJson = value => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};
