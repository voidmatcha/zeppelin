/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { dot } from './dot.js';
import { CHECKED, HEALTH, LABEL } from './card.js';

export const LABELS_BADGE = Object.fromEntries(
  HEALTH.map(state => [state, LABEL[state][0].toUpperCase() + LABEL[state].slice(1)])
);
const TIP = {
  healthy: ['spark', 'shared: process running'],
  unhealthy: ['python', 'shared: process not responding'],
  starting: ['spark', 'shared: process is starting'],
  'not-running': ['spark', 'No interpreter process is running.', 'It starts on first use.'],
  checking: null,
  unknown: ['Not checked yet', 'Click to check again.']
};

// Reasons of a failure as written next to the label; they map to the server's reason codes.
const REASONS = {
  gone: ['Process gone', 'Process is gone'],
  silent: ['No answer', 'Process exists but does not answer'],
  timeout: ['Timed out', 'No answer within 3000 ms']
};
// The reason is written in the row; the native title only carries the check time.
const titleFor = state =>
  state === 'checking' ? '' : state === 'unknown' ? 'Not checked yet. Click to check again.' : CHECKED;
const badgeButton = (name, state, reason, of) => {
  const why =
    state === 'unhealthy'
      ? `${REASONS[reason][0]}${of ? ` (${of})` : ''}`
      : state === 'not-running'
        ? 'starts on use'
        : state === 'failed'
          ? 'No privilege to check the interpreter health (last: Healthy)'
          : '';
  const title = state === 'failed' ? 'Last result: Healthy, checked at 10:04:48 AM' : titleFor(state);
  return `<button type="button" class="badge btn" data-state="${state}"${title ? ` title="${title}"` : ''} aria-label="${name}: ${LABELS_BADGE[state]}${why ? ', ' + why.toLowerCase() : ''}. Check again"><span class="text">${LABELS_BADGE[state]}${why ? ` | ${why}` : ''}</span>${dot(state)}</button>`;
};

const names = (name, children, first) =>
  children.map((c, i) => `% ${i === 0 && !first ? name : c}${i === 0 && first ? '(default)' : ''}`).join(', ');
const nameButton = ([name, children], i) =>
  `<button type="button" class="sp-btn md primary"><span class="main">${name}</span><small>${names(name, children, i === 0)}</small></button>`;

const frame = body => `<div class="sp">
  <h2>Settings</h2>
  <hr>
  <h3>Interpreter binding</h3>
  <p>Bind interpreter for this note. Click to Bind/Unbind interpreter. Drag and drop to reorder interpreters.<br>The first interpreter on the list becomes default. To create/remove interpreters, go to <a href="#">Interpreter</a> menu.</p>
  <div class="sp-list">${body}</div>
  <div class="sp-actions"><button type="button" class="sp-btn md primary">Save</button><button type="button" class="sp-btn md">Cancel</button></div>
</div>`;
const REFRESH =
  '<span class="sp-refresh" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 2.5v4.2h-4.2M6 21.5v-4.2h4.2"/></svg></span>';

// The badge is the control at the far right of the row and says why in the row.
export const settingsRight = rows =>
  frame(
    rows
      .map(
        ([b, state, why, of], i) => `
    <div class="sp-box right">${REFRESH}${nameButton(b, i)}${badgeButton(b[0], state, why, of)}</div>`
      )
      .join('')
  );

export const BINDINGS = [
  ['spark', ['spark', 'sql', 'pyspark', 'ipyspark']],
  ['python', ['python', 'python.ipython', 'python.sql', 'python.conda', 'python.docker']],
  ['jdbc', ['jdbc']],
  ['sh', ['sh']],
  ['md', ['md']],
  ['flink', ['flink', 'ssql', 'pyflink']],
  ['livy', ['livy', 'livy.pyspark', 'livy.sql']]
];
