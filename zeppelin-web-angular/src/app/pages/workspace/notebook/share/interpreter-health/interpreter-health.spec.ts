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

import { interpreterHealthErrorMessage, summarizeInterpreterHealth } from './interpreter-health';

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
