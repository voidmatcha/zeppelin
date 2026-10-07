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

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BRACES_ADVISORY, BRACES_EXCEPTION_EXPIRES, evaluateAudit } = require('./audit-policy.cjs');

const lockfile = {
  packages: {
    'node_modules/webpack-dev-server': { dependencies: { 'http-proxy-middleware': '^4.1.1' } },
    'node_modules/http-proxy-middleware': { dependencies: { micromatch: '^4.0.8' } },
    'node_modules/micromatch': { dependencies: { braces: '^3.0.3' } },
    'node_modules/braces': { version: '3.0.3' }
  }
};
const report = {
  vulnerabilities: {
    braces: { severity: 'high', via: [{ url: BRACES_ADVISORY }] },
    micromatch: { severity: 'high', via: ['braces'] },
    'http-proxy-middleware': { severity: 'high', via: ['micromatch'] },
    'webpack-dev-server': { severity: 'high', via: ['http-proxy-middleware'] }
  }
};

test('allows only the known advisory on the expected development path', () => {
  assert.deepEqual(evaluateAudit(report, lockfile, BRACES_EXCEPTION_EXPIRES - 1), {
    allowed: ['braces', 'micromatch', 'http-proxy-middleware', 'webpack-dev-server'],
    blocked: []
  });
});

test('blocks the exception at its expiry', () => {
  assert.deepEqual(evaluateAudit(report, lockfile, BRACES_EXCEPTION_EXPIRES).blocked, [
    'braces',
    'micromatch',
    'http-proxy-middleware',
    'webpack-dev-server'
  ]);
});

test('blocks another advisory or dependency path', () => {
  const unexpectedReport = structuredClone(report);
  unexpectedReport.vulnerabilities.braces.via.push({ url: 'https://github.com/advisories/GHSA-other' });
  assert.equal(evaluateAudit(unexpectedReport, lockfile, BRACES_EXCEPTION_EXPIRES - 1).blocked.length, 4);

  const unexpectedLockfile = structuredClone(lockfile);
  unexpectedLockfile.packages['node_modules/another-tool'] = { dependencies: { braces: '^3.0.3' } };
  assert.equal(evaluateAudit(report, unexpectedLockfile, BRACES_EXCEPTION_EXPIRES - 1).blocked.length, 4);
});
