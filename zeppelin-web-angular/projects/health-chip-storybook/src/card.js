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

export const HEALTH = ['healthy', 'unhealthy', 'starting', 'not-running', 'checking', 'unknown', 'failed'];
export const LABEL = {
  healthy: 'healthy',
  unhealthy: 'unhealthy',
  starting: 'starting',
  'not-running': 'not running',
  checking: 'checking',
  unknown: 'not checked',
  failed: 'check failed'
};
// What the chip writes: the state, then why when it is not healthy (the same words as the application).
const FAILURE = 'No privilege to check the interpreter health';
export const TEXT = {
  healthy: 'Healthy',
  unhealthy: 'Unhealthy | No answer',
  starting: 'Starting',
  'not-running': 'Not running | starts on use',
  checking: 'Checking',
  unknown: 'Not checked',
  failed: `Check failed | ${FAILURE} (last: Healthy)`
};

export const CHECKED = 'Checked at 10:04:48 AM';
const WHY = {
  unhealthy: 'Process exists but does not answer',
  'not-running': 'No interpreter process is running.\nIt starts on first use.',
  starting: 'The interpreter process is starting.',
  unknown: 'Not checked yet.',
  failed: `${FAILURE}\nLast result: Healthy, checked at 10:04:48 AM`
};
// The tooltip follows the WAI-ARIA tooltip pattern: role="tooltip", aria-describedby, never focusable.
let tipSeq = 0;
const tipFor = (interp, state, id) => {
  if (state === 'checking') return '';
  const lines = [`<strong>${interp}: ${LABEL[state][0].toUpperCase()}${LABEL[state].slice(1)}</strong>`];
  if (WHY[state]) lines.push(...WHY[state].split('\n'));
  if (state !== 'unknown' && state !== 'failed') lines.push(CHECKED);
  lines.push('Click to check again');
  return `<span class="tip" id="${id}" role="tooltip">${lines.join('<br>')}<span class="tip-arrow"></span></span>`;
};

// Interpolated values are fixed enums or a counter; the code sample is escaped.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// Healthy and checking are a dot alone; every other state is written out.
const NO_WORDS = ['healthy', 'checking'];
export const chip = (interp, state) => {
  const id = `zx-tip-${++tipSeq}`;
  const tip = tipFor(interp, state, id);
  return `<button type="button" class="zx-ih" data-state="${state}"${tip ? ` aria-describedby="${id}"` : ''} aria-label="${interp} interpreter: ${TEXT[state]}. Activate to check again">${!NO_WORDS.includes(state) ? `<span class="zx-text">${TEXT[state]}</span>` : ''}${dot(state)}${tip}</button>`;
};

const HANDLE =
  '<svg class="zp-handle" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 10 10 20M20 15l-5 5"/></svg>';
const TABLE =
  '<table><thead><tr>' +
  Array.from({ length: 8 }, (_, i) => `<th>col_${i}</th>`).join('') +
  '</tr></thead><tbody>' +
  Array.from(
    { length: 4 },
    (_, r) => '<tr>' + Array.from({ length: 8 }, (_, c) => `<td>r${r}-c${c} value</td>`).join('') + '</tr>'
  ).join('') +
  '</tbody></table>';
const OUTPUT = {
  text: `<div class="zp-result"><pre>hello from the interpreter\nsecond line of output</pre>${HANDLE}</div>`,
  table: `<div class="zp-result table">${TABLE}${HANDLE}</div>`,
  error: `<div class="zp-result error"><pre>Traceback (most recent call last):\n  File "&lt;stdin&gt;", line 1, in &lt;module&gt;\nNameError: name 'x' is not defined</pre>${HANDLE}</div>`,
  none: ''
};
// Placeholders for the real control icons (run, collapse, book, settings): they only reproduce how crowded the top-right is.
const ICONS = '<span class="zp-ico" aria-hidden="true"></span>'.repeat(4);
export const STATUS = ['READY', 'PENDING', 'RUNNING', 'FINISHED', 'ERROR', 'ABORT'];
export const INTERPRETERS = ['python', 'sh', 'md', 'spark', 'flink', 'java', 'groovy', 'jdbc'];
const CODE = {
  python: '%python\nprint("hello")',
  sh: '%sh\necho hello',
  md: '%md\n# Title',
  spark: '%spark\nspark.range(10).show()',
  flink: '%flink\nval x = 1',
  java: '%java\nSystem.out.println(1);',
  groovy: '%groovy\nprintln 1',
  jdbc: '%jdbc\nselect 1'
};

// The chip sits at the right end of the 30px footer row.
export function card({
  interpreter = 'python',
  health = 'healthy',
  status = 'FINISHED',
  output = 'text',
  widthCols = 12
} = {}) {
  const hasFooter = !['READY', 'PENDING'].includes(status) && output !== 'none';
  const footer = hasFooter
    ? '<div class="footer">Took 0 seconds. Last updated by anonymous at October 17 2026, 9:30:12 AM.</div>'
    : '<div class="footer"></div>';
  const out =
    status === 'ERROR'
      ? OUTPUT.error
      : status === 'READY' || status === 'PENDING' || status === 'RUNNING'
        ? ''
        : OUTPUT[output];
  return `<div style="width:${(widthCols / 12) * 100}%;min-width:0">
  <div class="zp">
    <div class="zp-ctl"><span class="zp-status">${status}</span>${ICONS}</div>
    <div class="zp-code">${esc(CODE[interpreter])}</div>
    ${out}
    <div class="zp-ft">${footer}${chip(interpreter, health)}</div>
  </div>
</div>`;
}
