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

import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

import { InterpreterGroupHealth, InterpreterHealthCheck } from '@zeppelin/interfaces';

export type InterpreterHealthState = 'healthy' | 'unhealthy' | 'starting' | 'not-running';

export interface InterpreterHealthSummary {
  state: InterpreterHealthState;
  label: string;
}

export interface InterpreterGroupDetail {
  name: string;
  detail: string;
}

/** What a check found and when. */
export interface InterpreterHealthVerdict {
  health: InterpreterHealthCheck;
  checkedAt: Date;
}

// Not running (never started, or closed by a restart) is a normal state, not a failure.
const isFailure = (group: InterpreterGroupHealth): boolean =>
  !group.healthy && group.reason !== 'LAUNCHING' && group.reason !== 'NOT_RUNNING';

/** Reduces the verdicts of a setting's processes to one state; a failing process outweighs a healthy one. */
export const summarizeInterpreterHealth = (check: InterpreterHealthCheck): InterpreterHealthSummary => {
  if (check.groups.some(isFailure)) {
    return { state: 'unhealthy', label: 'Unhealthy' };
  }
  if (check.groups.some(group => group.healthy)) {
    return { state: 'healthy', label: 'Healthy' };
  }
  if (check.groups.some(group => group.reason === 'LAUNCHING')) {
    return { state: 'starting', label: 'Starting' };
  }
  return { state: 'not-running', label: 'Not running' };
};

const describeGroup = (group: InterpreterGroupHealth): string => {
  switch (group.reason) {
    case 'OK':
      return `Answered in ${group.probeTookMs} ms`;
    case 'NOT_REACHABLE':
      if (group.alive === true) {
        return 'Process exists but does not answer';
      }
      return group.alive === false ? 'Process is gone' : 'Could not be reached';
    case 'PROBE_TIMEOUT':
      return `No answer within ${group.probeTookMs} ms`;
    case 'LAUNCHING':
      return 'Starting';
    case 'NOT_RUNNING':
      return 'Not running';
    default:
      return group.reason;
  }
};

/** One line per process, failing ones first so that a cut-short list keeps the reason. */
export const describeInterpreterGroups = (check: InterpreterHealthCheck): InterpreterGroupDetail[] => {
  const prefix = `${check.settingId}-`;
  return [...check.groups]
    .sort((a, b) => Number(isFailure(b)) - Number(isFailure(a)))
    .map(group => ({
      name: group.groupId.startsWith(prefix) ? group.groupId.slice(prefix.length) : group.groupId,
      detail: describeGroup(group)
    }));
};

export const interpreterHealthErrorMessage = (error: unknown): string => {
  if (error instanceof TimeoutError) {
    return 'The server did not answer in time';
  }
  if (error instanceof HttpErrorResponse) {
    // A proxy can answer 403 before the endpoint is reached, so every refusal gets the same wording.
    if (error.status === 403) {
      return 'No privilege to check the interpreter health';
    }
    const message = error.error?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
    if (error.status === 404) {
      // A 404 that is not Zeppelin's JSON means the endpoint itself is missing (an older server).
      const isZeppelinAnswer = typeof error.error === 'object' && error.error !== null && 'status' in error.error;
      return isZeppelinAnswer
        ? 'Interpreter setting not found'
        : 'This server does not support interpreter health checks';
    }
  }
  return 'Failed to check the interpreter health';
};

const failingGroups = (check: InterpreterHealthCheck): InterpreterGroupHealth[] => check.groups.filter(isFailure);

const shortReason = (group: InterpreterGroupHealth): string => {
  switch (group.reason) {
    case 'PROBE_TIMEOUT':
      return 'Timed out';
    case 'NOT_REACHABLE':
      if (group.alive === true) {
        return 'No answer';
      }
      return group.alive === false ? 'Process gone' : 'Unreachable';
    default:
      return group.reason;
  }
};

/** The few words next to the label that say why a state is not green; "(1 of 2)" counts failing processes. */
export const summarizeInterpreterHealthReason = (check: InterpreterHealthCheck): string | undefined => {
  const summary = summarizeInterpreterHealth(check);
  if (summary.state === 'not-running') {
    return 'starts on use';
  }
  if (summary.state !== 'unhealthy') {
    return undefined;
  }
  const failing = failingGroups(check);
  const reason = shortReason(failing[0]);
  return check.groups.length > 1 ? `${reason} (${failing.length} of ${check.groups.length})` : reason;
};

export type InterpreterHealthViewState = InterpreterHealthState | 'checking' | 'failed' | 'unknown';

export interface InterpreterHealthView {
  state: InterpreterHealthViewState;
  /** The state in a word or two. */
  label: string;
  /** Why, in a few words: the reason of a failure, or why the last check failed. */
  reason?: string;
  /** What the last answer said, which stays in view beside a failed check. */
  lastLabel?: string;
  /** What is written: the label, then the reason, then after a failed check the last answer. */
  text: string;
}

/** What the chip and the badge show for a setting. */
export const viewInterpreterHealth = (known: {
  verdict?: InterpreterHealthVerdict;
  loading: boolean;
  error?: string;
}): InterpreterHealthView => {
  const summary = known.verdict ? summarizeInterpreterHealth(known.verdict.health) : undefined;
  const lastLabel = summary?.label;
  if (known.loading) {
    return { state: 'checking', label: 'Checking', lastLabel, text: 'Checking' };
  }
  if (known.error) {
    const text = `Check failed | ${known.error}${lastLabel ? ` (last: ${lastLabel})` : ''}`;
    return { state: 'failed', label: 'Check failed', reason: known.error, lastLabel, text };
  }
  if (!known.verdict || !summary) {
    return { state: 'unknown', label: 'Not checked', text: 'Not checked' };
  }
  const reason = summarizeInterpreterHealthReason(known.verdict.health);
  return {
    state: summary.state,
    label: summary.label,
    reason,
    lastLabel,
    text: reason ? `${summary.label} | ${reason}` : summary.label
  };
};
