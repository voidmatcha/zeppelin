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

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BRACES_ADVISORY, BRACES_EXCEPTION_EXPIRES, evaluateAudit } = require('./audit-policy.cjs');

const packageDirectory = path.resolve(__dirname, '..');
const audit = spawnSync('npm', ['audit', '--json', '--audit-level=high'], {
  cwd: packageDirectory,
  encoding: 'utf8'
});

if (audit.error || !audit.stdout) {
  console.error(audit.error?.message ?? audit.stderr ?? 'npm audit produced no report');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  console.error(audit.stdout);
  console.error(`Unable to parse npm audit output: ${error.message}`);
  process.exit(1);
}

const lockfile = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package-lock.json'), 'utf8'));
const result = evaluateAudit(report, lockfile);

if (result.blocked.length > 0) {
  console.error(`npm audit found blocked high or critical vulnerabilities: ${result.blocked.join(', ')}`);
  process.exit(1);
}

if (result.allowed.length > 0) {
  console.warn(
    `Temporarily allowing ${BRACES_ADVISORY} on the webpack-dev-server development path until ${new Date(
      BRACES_EXCEPTION_EXPIRES
    ).toISOString()}`
  );
}
