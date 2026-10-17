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
import { describe, expect, it } from 'vitest';

import { InterpreterGroupHealth, InterpreterHealthCheck, InterpreterHealthReason } from '@zeppelin/interfaces';

import {
  describeInterpreterGroups,
  interpreterHealthErrorMessage,
  summarizeInterpreterHealth,
  summarizeInterpreterHealthReason
} from './interpreter-health';

const group = (
  suffix: string,
  reason: InterpreterHealthReason,
  extra: Partial<InterpreterGroupHealth> = {}
): InterpreterGroupHealth => ({
  groupId: `spark-${suffix}`,
  healthy: reason === 'OK',
  reason,
  probeTookMs: 12,
  ...extra
});

const check = (...groups: InterpreterGroupHealth[]): InterpreterHealthCheck => ({
  settingId: 'spark',
  settingName: 'spark',
  groups
});

describe('summarizeInterpreterHealth', () => {
  it('lets a failing process outweigh a healthy one', () => {
    expect(summarizeInterpreterHealth(check(group('a', 'OK'), group('b', 'PROBE_TIMEOUT'))).state).toBe('unhealthy');
  });

  it('reports a setting whose processes all answer as healthy', () => {
    expect(summarizeInterpreterHealth(check(group('a', 'OK'))).label).toBe('Healthy');
  });

  it('treats a launching process as starting, not as a failure', () => {
    expect(summarizeInterpreterHealth(check(group('a', 'LAUNCHING'))).state).toBe('starting');
  });

  it('treats a setting with nothing running as neutral', () => {
    expect(summarizeInterpreterHealth(check()).state).toBe('not-running');
    expect(summarizeInterpreterHealth(check(group('a', 'NOT_RUNNING'))).state).toBe('not-running');
  });
});

describe('summarizeInterpreterHealthReason', () => {
  it('says why a process fails in a few words', () => {
    expect(summarizeInterpreterHealthReason(check(group('a', 'NOT_REACHABLE', { alive: true })))).toBe('No answer');
    expect(summarizeInterpreterHealthReason(check(group('a', 'NOT_REACHABLE', { alive: false })))).toBe('Process gone');
    expect(summarizeInterpreterHealthReason(check(group('a', 'NOT_REACHABLE')))).toBe('Unreachable');
    expect(summarizeInterpreterHealthReason(check(group('a', 'PROBE_TIMEOUT')))).toBe('Timed out');
  });

  it('counts the failing processes when there are several', () => {
    expect(summarizeInterpreterHealthReason(check(group('a', 'OK'), group('b', 'PROBE_TIMEOUT')))).toBe(
      'Timed out (1 of 2)'
    );
  });

  it('tells that a setting with nothing running starts on first use', () => {
    expect(summarizeInterpreterHealthReason(check())).toBe('starts on use');
  });

  it('has nothing to add for a healthy or a starting setting', () => {
    expect(summarizeInterpreterHealthReason(check(group('a', 'OK')))).toBeUndefined();
    expect(summarizeInterpreterHealthReason(check(group('a', 'LAUNCHING')))).toBeUndefined();
  });
});

describe('describeInterpreterGroups', () => {
  it('names a process without the setting id and lists the failing ones first', () => {
    const lines = describeInterpreterGroups(
      check(group('shared_process', 'OK'), group('bob', 'NOT_REACHABLE', { alive: false }))
    );

    expect(lines.map(line => line.name)).toEqual(['bob', 'shared_process']);
    expect(lines[0].detail).toBe('Process is gone');
    expect(lines[1].detail).toBe('Answered in 12 ms');
  });
});

describe('interpreterHealthErrorMessage', () => {
  it('words every refusal the same way', () => {
    expect(interpreterHealthErrorMessage(new HttpErrorResponse({ status: 403 }))).toBe(
      'No privilege to check the interpreter health'
    );
  });

  it('prefers the message of the server', () => {
    expect(interpreterHealthErrorMessage(new HttpErrorResponse({ status: 500, error: { message: 'boom' } }))).toBe(
      'boom'
    );
  });

  it('knows a missing setting and falls back for anything else', () => {
    expect(interpreterHealthErrorMessage(new HttpErrorResponse({ status: 404 }))).toBe('Interpreter setting not found');
    expect(interpreterHealthErrorMessage(new Error('x'))).toBe('Failed to check the interpreter health');
  });
});
