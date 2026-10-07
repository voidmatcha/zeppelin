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

const BRACES_ADVISORY = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const BRACES_EXCEPTION_EXPIRES = Date.parse('2026-12-04T00:00:00Z');
const ALLOWED_PACKAGES = new Set(['braces', 'micromatch', 'http-proxy-middleware', 'webpack-dev-server']);
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

function directParents(packages, dependencyName) {
  return Object.entries(packages)
    .filter(([, value]) => value.dependencies?.[dependencyName])
    .map(([name]) => name)
    .sort();
}

function validateBracesPath(lockfile) {
  const packages = lockfile.packages ?? {};
  const expectedParents = new Map([
    ['braces', ['node_modules/micromatch']],
    ['micromatch', ['node_modules/http-proxy-middleware']],
    ['http-proxy-middleware', ['node_modules/webpack-dev-server']]
  ]);

  if (packages['node_modules/braces']?.version !== '3.0.3') {
    return false;
  }

  return [...expectedParents].every(
    ([dependency, parents]) => JSON.stringify(directParents(packages, dependency)) === JSON.stringify(parents)
  );
}

function collectCauses(vulnerabilities, name, visited = new Set()) {
  if (visited.has(name)) {
    return { advisories: [], packages: visited };
  }

  visited.add(name);
  const advisories = [];
  for (const cause of vulnerabilities[name]?.via ?? []) {
    if (typeof cause === 'string') {
      advisories.push(...collectCauses(vulnerabilities, cause, visited).advisories);
    } else {
      advisories.push(cause);
    }
  }
  return { advisories, packages: visited };
}

function evaluateAudit(report, lockfile, now = Date.now()) {
  const vulnerabilities = report.vulnerabilities ?? {};
  const blocking = Object.entries(vulnerabilities).filter(([, value]) =>
    BLOCKING_SEVERITIES.has(value.severity)
  );
  const allowed = [];
  const blocked = [];

  for (const [name] of blocking) {
    const causes = collectCauses(vulnerabilities, name);
    const isAllowed =
      now < BRACES_EXCEPTION_EXPIRES &&
      validateBracesPath(lockfile) &&
      causes.advisories.length > 0 &&
      causes.advisories.every(advisory => advisory.url === BRACES_ADVISORY) &&
      [...causes.packages].every(packageName => ALLOWED_PACKAGES.has(packageName));

    (isAllowed ? allowed : blocked).push(name);
  }

  return { allowed, blocked };
}

module.exports = {
  BRACES_ADVISORY,
  BRACES_EXCEPTION_EXPIRES,
  evaluateAudit,
  validateBracesPath
};
