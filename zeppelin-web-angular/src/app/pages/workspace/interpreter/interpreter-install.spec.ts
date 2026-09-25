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

import { describe, expect, it } from 'vitest';

import { isInterpreterInstallMessageFor, parseInterpreterInstallRequest } from './interpreter-install';

describe('interpreter installation form', () => {
  it('accepts a Maven coordinate and trims its fields', () => {
    expect(parseInterpreterInstallRequest('  spark  ', ' org.apache.zeppelin:zeppelin-spark:0.12.0 ')).toEqual({
      name: 'spark',
      artifact: 'org.apache.zeppelin:zeppelin-spark:0.12.0'
    });
  });

  it('rejects directory traversal and non-Maven artifact values', () => {
    expect(parseInterpreterInstallRequest('../spark', 'group:artifact:1')).toBeNull();
    expect(parseInterpreterInstallRequest('spark', 'group:artifact')).toBeNull();
  });

  it('matches only status messages for the requested interpreter name', () => {
    expect(isInterpreterInstallMessageFor('Starting to download spark interpreter', 'spark')).toBe(true);
    expect(isInterpreterInstallMessageFor('spark downloaded', 'spark')).toBe(true);
    expect(isInterpreterInstallMessageFor('Error while downloading spark as unavailable', 'spark')).toBe(true);
    expect(isInterpreterInstallMessageFor('sparksql downloaded', 'spark')).toBe(false);
  });
});
