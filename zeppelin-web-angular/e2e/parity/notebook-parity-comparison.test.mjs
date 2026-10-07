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
import test from 'node:test';

import { compareNotebookParity } from './notebook-parity-comparison.mjs';

const registry = {
  scenarios: [
    {
      id: 'NB-PARITY-001',
      observableOutcomes: [
        { id: 'NB-PARITY-001-OUTCOME-001', description: 'the notebook is visible' },
        { id: 'NB-PARITY-001-OUTCOME-002', description: 'the notebook title is visible' }
      ]
    }
  ]
};

const checkpoint = {
  id: 'read-only-checkpoint',
  requiredOutcomes: ['NB-PARITY-001-OUTCOME-001']
};

const fixture = {
  note: {
    id: 'note-1',
    title: 'Expected note'
  }
};

const observations = (container, title = 'Expected note') => ({
  'NB-PARITY-001-OUTCOME-001': {
    status: 'observed',
    value: { visible: container },
    evidence: ['container observation']
  },
  'NB-PARITY-001-OUTCOME-002': {
    status: 'observed',
    value: { title },
    evidence: ['heading observation']
  }
});

const participant = (id, run) => ({ id, run });
const baseline = participant('existing-angular', async () => observations(true));

const getOutcome = (result, implementationId, outcomeId) =>
  result.implementations
    .find(implementation => implementation.id === implementationId)
    .scenarios.flatMap(scenario => scenario.outcomes)
    .find(outcome => outcome.id === outcomeId);

test('passes matching implementations while keeping checkpoint and full scenario status separate', async () => {
  const result = await compareNotebookParity({
    registry,
    checkpoint,
    fixture,
    baseline,
    implementations: {
      angular: participant('angular', async () => observations(true)),
      react: participant('react', async () => observations(true))
    }
  });

  assert.equal(result.checkpoint.status, 'pass');
  assert.deepEqual(
    result.implementations.map(implementation => implementation.id),
    ['angular', 'react']
  );
  assert.deepEqual(
    result.implementations.flatMap(implementation => implementation.scenarios.map(scenario => scenario.status)),
    ['pass', 'pass']
  );
});

test('fails the mismatching implementation and retains expected, actual, reason, and evidence', async () => {
  const result = await compareNotebookParity({
    registry,
    checkpoint,
    fixture,
    baseline,
    implementations: {
      angular: participant('angular', async () => observations(true)),
      react: participant('react', async () => observations(false))
    }
  });

  const outcome = getOutcome(result, 'react', 'NB-PARITY-001-OUTCOME-001');
  assert.equal(result.checkpoint.status, 'fail');
  assert.deepEqual(outcome.expected, { visible: true });
  assert.deepEqual(outcome.actual, { visible: false });
  assert.match(outcome.reason, /baseline oracle/);
  assert.deepEqual(outcome.evidence, ['container observation']);
});

test('fails a defect shared by both implementations when the baseline oracle disagrees', async () => {
  const result = await compareNotebookParity({
    registry,
    checkpoint,
    fixture,
    baseline,
    implementations: {
      angular: participant('angular', async () => observations(false)),
      react: participant('react', async () => observations(false))
    }
  });

  assert.equal(result.checkpoint.status, 'fail');
  assert.deepEqual(
    result.implementations.map(
      implementation => getOutcome(result, implementation.id, 'NB-PARITY-001-OUTCOME-001').status
    ),
    ['fail', 'fail']
  );
});

test('reports missing, skipped, and blocked outcomes as not implemented and never passes the gate', async () => {
  const result = await compareNotebookParity({
    registry,
    checkpoint,
    fixture,
    baseline,
    implementations: {
      angular: participant('angular', async () => ({
        'NB-PARITY-001-OUTCOME-001': {
          status: 'skipped',
          reason: 'browser capability unavailable'
        },
        'NB-PARITY-001-OUTCOME-002': {
          status: 'blocked',
          reason: 'fixture dependency unavailable'
        }
      })),
      react: participant('react', async () => ({}))
    }
  });

  assert.equal(result.checkpoint.status, 'fail');
  assert.equal(getOutcome(result, 'angular', 'NB-PARITY-001-OUTCOME-001').status, 'not-implemented');
  assert.match(getOutcome(result, 'angular', 'NB-PARITY-001-OUTCOME-001').reason, /skipped/);
  assert.equal(getOutcome(result, 'angular', 'NB-PARITY-001-OUTCOME-002').status, 'not-implemented');
  assert.match(getOutcome(result, 'react', 'NB-PARITY-001-OUTCOME-001').reason, /did not report/);
});

test('does not mark the full scenario passed when only the checkpoint subset is implemented', async () => {
  const requiredOnly = {
    'NB-PARITY-001-OUTCOME-001': {
      status: 'observed',
      value: { visible: true }
    }
  };
  const result = await compareNotebookParity({
    registry,
    checkpoint,
    fixture,
    baseline,
    implementations: {
      angular: participant('angular', async () => requiredOnly),
      react: participant('react', async () => requiredOnly)
    }
  });

  assert.equal(result.checkpoint.status, 'pass');
  assert.deepEqual(
    result.implementations.map(implementation => implementation.scenarios[0].status),
    ['not-implemented', 'not-implemented']
  );
});

test('isolates fixture mutations and runs registered cleanup after every participant', async () => {
  const seenTitles = [];
  const cleanups = [];
  const mutatingParticipant = id =>
    participant(id, async ({ fixture: participantFixture, onCleanup }) => {
      seenTitles.push(participantFixture.note.title);
      participantFixture.note.title = `${id} mutation`;
      onCleanup(() => cleanups.push(id));
      return observations(true);
    });

  await compareNotebookParity({
    registry,
    checkpoint,
    fixture,
    baseline: mutatingParticipant('existing-angular'),
    implementations: {
      angular: mutatingParticipant('angular'),
      react: mutatingParticipant('react')
    }
  });

  assert.deepEqual(seenTitles, ['Expected note', 'Expected note', 'Expected note']);
  assert.deepEqual(cleanups, ['existing-angular', 'angular', 'react']);
  assert.equal(fixture.note.title, 'Expected note');
});

test('turns participant and cleanup failures into outcome failures with reasons', async () => {
  const result = await compareNotebookParity({
    registry,
    checkpoint,
    fixture,
    baseline,
    implementations: {
      angular: participant('angular', async ({ onCleanup }) => {
        onCleanup(() => {
          throw new Error('subscription cleanup failed');
        });
        return observations(true);
      }),
      react: participant('react', async () => {
        throw new Error('adapter crashed');
      })
    }
  });

  assert.equal(result.checkpoint.status, 'fail');
  assert.match(getOutcome(result, 'angular', 'NB-PARITY-001-OUTCOME-001').reason, /subscription cleanup failed/);
  assert.match(getOutcome(result, 'react', 'NB-PARITY-001-OUTCOME-001').reason, /adapter crashed/);
});

test('produces the same sorted report when implementation execution order is reversed', async () => {
  const options = {
    registry,
    checkpoint,
    fixture,
    baseline,
    implementations: {
      angular: participant('angular', async () => observations(true)),
      react: participant('react', async () => observations(true))
    }
  };

  const forward = await compareNotebookParity({ ...options, implementationOrder: ['angular', 'react'] });
  const reversed = await compareNotebookParity({ ...options, implementationOrder: ['react', 'angular'] });

  assert.deepEqual(reversed, forward);
});
