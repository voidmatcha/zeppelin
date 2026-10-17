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

/** What a check found and when, since the badge stays on screen after the answer has aged. */
export interface InterpreterHealthVerdict {
  health: InterpreterHealthCheck;
  checkedAt: Date;
}

// Not being up yet, or not any more after a restart, is a normal state and never a failure.
const isFailure = (group: InterpreterGroupHealth): boolean =>
  !group.healthy && group.reason !== 'LAUNCHING' && group.reason !== 'NOT_RUNNING';

/**
 * Reduces the verdicts of the interpreter processes of a setting to the one state a badge shows.
 * A failing process outweighs a healthy one, because the setting is then not fully usable. A
 * setting with nothing running is neutral: a restart only closes the processes and the next use
 * starts them again.
 */
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

/**
 * One line per interpreter process, named without the setting id every group id starts with. The
 * failing ones come first, so that a list cut short does not hide the reason for a red badge.
 */
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
    // The web server can turn the caller away before the endpoint is reached, and then it only says
    // 'Forbidden', so every refusal gets the same wording.
    if (error.status === 403) {
      return 'No privilege to check the interpreter health';
    }
    const message = error.error?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
    if (error.status === 404) {
      // A missing setting is answered in the JSON of Zeppelin; a 404 in anything else (the page of the web server)
      // means that the endpoint itself is not there, as on a server that does not have the health check yet.
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

/**
 * The few words that say why a badge is not green, written next to its label so that nobody has to hover
 * for them: why a failing setting fails, and that a setting with nothing running starts on first use. With
 * several processes the number of failing ones follows ("Timed out (1 of 2)").
 */
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
