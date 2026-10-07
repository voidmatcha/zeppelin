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

import { isDeepStrictEqual } from 'node:util';

const IMPLEMENTATION_STATUSES = new Set(['observed', 'not-implemented', 'blocked', 'skipped']);

const cloneFixture = fixture => globalThis.structuredClone(fixture);

const createRegistryIndex = registry => {
  if (!registry || !Array.isArray(registry.scenarios)) {
    throw new TypeError('A notebook parity registry with scenarios is required');
  }

  const scenarios = new Map();
  const outcomes = new Map();
  for (const scenario of registry.scenarios) {
    if (!scenario?.id || !Array.isArray(scenario.observableOutcomes)) {
      throw new TypeError('Every notebook parity scenario must declare an id and observable outcomes');
    }
    scenarios.set(scenario.id, scenario);
    for (const outcome of scenario.observableOutcomes) {
      if (!outcome?.id || outcomes.has(outcome.id)) {
        throw new TypeError(`Notebook parity outcome id must be unique: ${outcome?.id ?? '<missing>'}`);
      }
      outcomes.set(outcome.id, { outcome, scenario });
    }
  }
  return { outcomes, scenarios };
};

const validateCheckpoint = (checkpoint, registryIndex) => {
  if (!checkpoint?.id || !Array.isArray(checkpoint.requiredOutcomes) || checkpoint.requiredOutcomes.length === 0) {
    throw new TypeError('A checkpoint id and at least one required outcome are required');
  }
  const uniqueOutcomes = new Set(checkpoint.requiredOutcomes);
  if (uniqueOutcomes.size !== checkpoint.requiredOutcomes.length) {
    throw new TypeError(`Checkpoint ${checkpoint.id} declares a duplicate outcome`);
  }
  for (const outcomeId of uniqueOutcomes) {
    if (!registryIndex.outcomes.has(outcomeId)) {
      throw new TypeError(`Checkpoint ${checkpoint.id} references unknown outcome ${outcomeId}`);
    }
  }
};

const normalizeObservations = (participantId, value, outcomeIds) => {
  const observations = value?.outcomes ?? value;
  if (!observations || typeof observations !== 'object' || Array.isArray(observations)) {
    throw new TypeError(`${participantId} must return an outcome observation object`);
  }

  const normalized = new Map();
  for (const outcomeId of outcomeIds) {
    const observation = observations[outcomeId];
    if (observation === undefined) {
      normalized.set(outcomeId, {
        status: 'not-implemented',
        reason: `${participantId} did not report ${outcomeId}`
      });
      continue;
    }
    if (!IMPLEMENTATION_STATUSES.has(observation?.status)) {
      throw new TypeError(`${participantId} reported an invalid status for ${outcomeId}`);
    }
    if (observation.status === 'observed' && !Object.hasOwn(observation, 'value')) {
      throw new TypeError(`${participantId} did not provide a value for observed outcome ${outcomeId}`);
    }
    if (observation.status !== 'observed' && typeof observation.reason !== 'string') {
      throw new TypeError(`${participantId} did not provide a reason for ${observation.status} outcome ${outcomeId}`);
    }
    if (observation.evidence !== undefined && !Array.isArray(observation.evidence)) {
      throw new TypeError(`${participantId} reported invalid evidence for ${outcomeId}`);
    }
    normalized.set(outcomeId, globalThis.structuredClone(observation));
  }
  return normalized;
};

const runParticipant = async ({ participant, fixture, outcomeIds }) => {
  const cleanups = [];
  let observations;
  let error;
  try {
    const value = await participant.run({
      fixture: cloneFixture(fixture),
      outcomeIds: [...outcomeIds],
      onCleanup(cleanup) {
        if (typeof cleanup !== 'function') {
          throw new TypeError(`${participant.id} registered a non-function cleanup`);
        }
        cleanups.push(cleanup);
      }
    });
    observations = normalizeObservations(participant.id, value, outcomeIds);
  } catch (participantError) {
    error = participantError;
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (cleanupError) {
        error = error
          ? new AggregateError([error, cleanupError], `${participant.id} execution and cleanup failed`)
          : cleanupError;
      }
    }
  }

  if (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return new Map(
      outcomeIds.map(outcomeId => [
        outcomeId,
        {
          status: 'failed',
          reason: `${participant.id} failed: ${reason}`
        }
      ])
    );
  }
  return observations;
};

const compareOutcome = ({ actual, baseline, implementationId, outcomeId }) => {
  if (baseline.status !== 'observed') {
    return {
      id: outcomeId,
      status: 'fail',
      reason: `Baseline oracle did not observe ${outcomeId}: ${baseline.reason ?? baseline.status}`,
      evidence: actual.evidence ?? []
    };
  }
  if (actual.status === 'failed') {
    return {
      id: outcomeId,
      status: 'fail',
      expected: baseline.value,
      reason: actual.reason,
      evidence: actual.evidence ?? []
    };
  }
  if (actual.status !== 'observed') {
    return {
      id: outcomeId,
      status: 'not-implemented',
      expected: baseline.value,
      reason: `${implementationId} reported ${actual.status}: ${actual.reason ?? 'no reason provided'}`,
      evidence: actual.evidence ?? []
    };
  }
  if (!isDeepStrictEqual(actual.value, baseline.value)) {
    return {
      id: outcomeId,
      status: 'fail',
      expected: baseline.value,
      actual: actual.value,
      reason: `${implementationId} disagrees with the baseline oracle`,
      evidence: actual.evidence ?? []
    };
  }
  return {
    id: outcomeId,
    status: 'pass',
    expected: baseline.value,
    actual: actual.value,
    evidence: actual.evidence ?? []
  };
};

const aggregateStatus = outcomes => {
  if (outcomes.some(outcome => outcome.status === 'fail')) {
    return 'fail';
  }
  if (outcomes.some(outcome => outcome.status === 'not-implemented')) {
    return 'not-implemented';
  }
  return 'pass';
};

const buildImplementationResult = ({ implementationId, observations, baseline, registryIndex }) => ({
  id: implementationId,
  scenarios: [...registryIndex.scenarios.values()].map(scenario => {
    const outcomes = scenario.observableOutcomes.map(outcome =>
      compareOutcome({
        actual: observations.get(outcome.id),
        baseline: baseline.get(outcome.id),
        implementationId,
        outcomeId: outcome.id
      })
    );
    return {
      id: scenario.id,
      status: aggregateStatus(outcomes),
      outcomes
    };
  })
});

const buildGate = ({ checkpoint, implementations }) => {
  const required = new Set(checkpoint.requiredOutcomes);
  const failures = [];
  for (const implementation of implementations) {
    for (const scenario of implementation.scenarios) {
      for (const outcome of scenario.outcomes) {
        if (required.has(outcome.id) && outcome.status !== 'pass') {
          failures.push({
            implementation: implementation.id,
            outcome: outcome.id,
            status: outcome.status,
            reason: outcome.reason
          });
        }
      }
    }
  }
  return {
    id: checkpoint.id,
    status: failures.length === 0 ? 'pass' : 'fail',
    requiredOutcomes: [...checkpoint.requiredOutcomes],
    failures
  };
};

/**
 * Compare independent notebook implementations against an existing-Angular oracle.
 * A checkpoint may require a subset, but scenario status always includes every
 * outcome declared by the existing parity registry.
 */
export const compareNotebookParity = async ({
  registry,
  checkpoint,
  fixture,
  baseline,
  implementations,
  implementationOrder = Object.keys(implementations ?? {}).sort()
}) => {
  const registryIndex = createRegistryIndex(registry);
  validateCheckpoint(checkpoint, registryIndex);
  if (!baseline?.id || typeof baseline.run !== 'function') {
    throw new TypeError('A baseline oracle participant is required');
  }
  if (!implementations || typeof implementations !== 'object' || Array.isArray(implementations)) {
    throw new TypeError('Notebook implementations are required');
  }
  const implementationIds = Object.keys(implementations).sort();
  if (
    implementationIds.length === 0 ||
    implementationOrder.length !== implementationIds.length ||
    new Set(implementationOrder).size !== implementationOrder.length ||
    !implementationOrder.every(id => implementationIds.includes(id))
  ) {
    throw new TypeError('Implementation order must contain every implementation exactly once');
  }
  for (const id of implementationIds) {
    if (implementations[id]?.id !== id || typeof implementations[id].run !== 'function') {
      throw new TypeError(`Implementation ${id} must expose the same id and a run function`);
    }
  }

  const outcomeIds = [...registryIndex.outcomes.keys()];
  const baselineObservations = await runParticipant({ participant: baseline, fixture, outcomeIds });
  const observationsByImplementation = new Map();
  for (const id of implementationOrder) {
    observationsByImplementation.set(
      id,
      await runParticipant({ participant: implementations[id], fixture, outcomeIds })
    );
  }

  const implementationResults = implementationIds.map(id =>
    buildImplementationResult({
      implementationId: id,
      observations: observationsByImplementation.get(id),
      baseline: baselineObservations,
      registryIndex
    })
  );

  return {
    checkpoint: buildGate({ checkpoint, implementations: implementationResults }),
    implementations: implementationResults
  };
};
